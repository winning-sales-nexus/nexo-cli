import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { CredentialsStore } from '../src/config/credentials-store.js';
import type { CliContext } from '../src/context.js';
import type { FetchFunction } from '../src/http/nexo-client.js';
import { run } from '../src/run.js';

const TOKEN: string = `nexo_pat_${'b'.repeat(38)}`;
const API: string = 'https://mcp-nexo.winningsales.com.br';
const CONNECTOR: string = '019fd0a4-6b1e-7c2a-9d3f-5a8e2b7c4d10';
const QUERY_ID: string = `${CONNECTOR}:estoque_por_sku`;
const ACTION_ID: string = `${CONNECTOR}:incluir_pedido`;

interface Call {
    readonly method: string;
    readonly path: string;
    readonly body: unknown;
}

interface Harness {
    readonly context: CliContext;
    readonly calls: Call[];
    readonly out: () => string;
    readonly err: () => string;
}

type Route = (call: Call) => unknown;

function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function harness(routes: Readonly<Record<string, Route>>, options: { readonly tty?: boolean; readonly stdin?: string } = {}): Harness {
    const calls: Call[] = [];
    const stdout: PassThrough = new PassThrough();
    const stderr: PassThrough = new PassThrough();
    let out: string = '';
    let err: string = '';
    stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    stderr.on('data', (chunk: Buffer) => (err += chunk.toString()));
    const fetchFn: FetchFunction = (url: string, init: RequestInit) => {
        const call: Call = {
            method: init.method ?? 'GET',
            path: url.replace(API, ''),
            body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : null
        };
        calls.push(call);
        const route: Route | undefined = routes[`${call.method} ${call.path}`];
        if (route === undefined) {
            return Promise.resolve(json(404, { title: 'Não encontrado', status: 404 }));
        }
        const answer: unknown = route(call);
        return Promise.resolve(answer instanceof Response ? answer : json(200, answer));
    };
    const stdin: Readable = Readable.from([options.stdin ?? '']);
    Object.assign(stdin, { isTTY: options.tty === true });
    const context: CliContext = {
        store: new CredentialsStore(mkdtempSync(join(tmpdir(), 'nexo-erp-config-'))),
        env: { NEXO_TOKEN: TOKEN },
        stdin,
        stdout,
        stderr,
        fetchFn,
        openUrl: () => Promise.resolve(false)
    };
    return { context, calls, out: () => out, err: () => err };
}

const operations: unknown = {
    total: 2,
    mostrando: 2,
    operacoes: [
        {
            id: QUERY_ID,
            conector: 'Omie',
            key: 'estoque_por_sku',
            kind: 'query',
            label: 'Estoque por SKU',
            description: 'Lê o estoque',
            args: [{ key: 'sku', type: 'string', required: true }],
            saida: {},
            guide: 'Use o SKU do cadastro',
            notes: ['SKU em maiúsculas']
        },
        {
            id: ACTION_ID,
            conector: 'Omie',
            key: 'incluir_pedido',
            kind: 'action',
            label: 'Incluir pedido',
            description: 'Inclui um pedido',
            args: [],
            saida: {}
        }
    ]
};

const LIST: string = 'GET /v1/erp/operations';
const LIST_SEARCH: (term: string) => string = (term) => `GET /v1/erp/operations?search=${term}`;
const QUERY: string = `POST /v1/erp/operations/${CONNECTOR}%3Aestoque_por_sku/query`;
const PREVIEW: string = `POST /v1/erp/operations/${CONNECTOR}%3Aincluir_pedido/preview`;
const APPLY: string = `POST /v1/erp/operations/${CONNECTOR}%3Aincluir_pedido/apply`;

const preview: unknown = {
    id: ACTION_ID,
    acao: 'Incluir pedido',
    conector: 'Omie',
    escritas: [{ metodo: 'POST', host: 'erp.exemplo.com.br', url: '/pedidos', operacao: 'incluir', corpo: '{"numero":"1042"}' }],
    saidaDoEnsaio: { pedido: '1042' },
    confirmation: { token: 'tok.1', expiresAt: '2026-11-26T12:00:00.000Z' }
};

function applied(repetida: boolean): unknown {
    return { id: ACTION_ID, saida: { pedido: '1042' }, repetida, situacao: 'succeeded' };
}

describe('nexo erp list', () => {
    it('lists the operations with id, key, kind, connector, args, guide and notes, and survives answers without them', async () => {
        const h: Harness = harness({ [LIST]: () => operations });

        expect(await run(h.context, ['erp', 'list'])).toBe(0);
        expect(h.out()).toContain(`${QUERY_ID}  consulta  Estoque por SKU  [Omie]`);
        expect(h.out()).toContain('chave estoque_por_sku; args: sku:string*');
        expect(h.out()).toContain('guia: Use o SKU do cadastro');
        expect(h.out()).toContain('notas: ["SKU em maiúsculas"]');
        expect(h.out()).toContain(`${ACTION_ID}  ação`);
        expect(h.out()).toContain('sem argumentos');
    });

    it('sends the search and prints the whole answer with --json', async () => {
        const h: Harness = harness({ [LIST_SEARCH('estoque')]: () => operations });

        expect(await run(h.context, ['erp', 'list', 'estoque', '--json'])).toBe(0);
        expect(h.calls[0]?.path).toBe('/v1/erp/operations?search=estoque');
        expect(JSON.parse(h.out())).toEqual(operations);
    });

    it('says what the API warned when nothing comes', async () => {
        const h: Harness = harness({ [LIST]: () => ({ total: 0, mostrando: 0, operacoes: [], aviso: 'Nenhum conector publicado.' }) });

        expect(await run(h.context, ['erp', 'list'])).toBe(0);
        expect(h.out()).toContain('Nenhum conector publicado.');
    });
});

describe('nexo erp query', () => {
    it('sends the args from JSON and from a file, and shows the result', async () => {
        const h: Harness = harness({ [QUERY]: () => ({ id: QUERY_ID, saida: { saldo: 7 }, emCache: false }) });
        const file: string = join(mkdtempSync(join(tmpdir(), 'nexo-erp-')), 'args.json');
        writeFileSync(file, '{"sku":"B-2"}');

        expect(await run(h.context, ['erp', 'query', QUERY_ID, '--args', '{"sku":"A-1"}'])).toBe(0);
        expect(await run(h.context, ['erp', 'query', QUERY_ID, '--args', `@${file}`])).toBe(0);
        expect(h.calls.map((call) => call.body)).toEqual([{ args: { sku: 'A-1' } }, { args: { sku: 'B-2' } }]);
        expect(h.out()).toContain('"saldo": 7');
    });

    it('resolves a key to the id through the listing', async () => {
        const h: Harness = harness({
            [LIST_SEARCH('estoque_por_sku')]: () => operations,
            [QUERY]: () => ({ id: QUERY_ID, saida: { saldo: 7 }, emCache: true })
        });

        expect(await run(h.context, ['erp', 'query', 'estoque_por_sku', '--args', '{}'])).toBe(0);
        expect(h.calls.map((call) => call.path)).toEqual([
            '/v1/erp/operations?search=estoque_por_sku',
            `/v1/erp/operations/${CONNECTOR}%3Aestoque_por_sku/query`
        ]);
        expect(h.out()).toContain('da memória do conector');
    });

    it('cuts a long result and refuses args that are not JSON before calling', async () => {
        const rows: unknown[] = Array.from({ length: 40 }, (_, index) => ({ n: index }));
        const h: Harness = harness({ [QUERY]: () => ({ id: QUERY_ID, saida: { rows }, emCache: false }) });

        expect(await run(h.context, ['erp', 'query', QUERY_ID])).toBe(0);
        expect(h.out()).toContain('veja com --json');
        expect(h.calls[0]?.body).toEqual({ args: {} });

        const refused: Harness = harness({});
        expect(await run(refused.context, ['erp', 'query', QUERY_ID, '--args', '{nao json'])).not.toBe(0);
        expect(refused.err()).toContain('não é JSON válido');
        expect(refused.calls).toEqual([]);
    });

    it('tells an unknown key apart, with the hint to list', async () => {
        const h: Harness = harness({ [LIST_SEARCH('nada')]: () => ({ total: 0, mostrando: 0, operacoes: [] }) });

        expect(await run(h.context, ['erp', 'query', 'nada'])).not.toBe(0);
        expect(h.err()).toContain('Não achei a operação nada');
        expect(h.err()).toContain('nexo erp list');
    });
});

describe('nexo erp action', () => {
    it('shows the preview and, without a terminal, applies nothing and prints the command to confirm', async () => {
        const h: Harness = harness({ [PREVIEW]: () => preview });

        expect(await run(h.context, ['erp', 'action', ACTION_ID, '--args', '{"numero":"1042"}'])).toBe(0);
        expect(h.out()).toContain('POST erp.exemplo.com.br/pedidos (incluir)');
        expect(h.err()).toContain(`nexo erp action ${ACTION_ID} --args '{"numero":"1042"}' --confirm tok.1`);
        expect(h.calls.map((call) => call.path)).toEqual([`/v1/erp/operations/${CONNECTOR}%3Aincluir_pedido/preview`]);
    });

    it('does not accept -y: it never applies an action without the person', async () => {
        const h: Harness = harness({ [PREVIEW]: () => preview });

        expect(await run(h.context, ['erp', 'action', ACTION_ID, '-y'])).not.toBe(0);
        expect(h.calls).toEqual([]);
    });

    it('applies with --confirm and the same args, with no preview', async () => {
        const h: Harness = harness({ [APPLY]: () => applied(false) });

        expect(await run(h.context, ['erp', 'action', ACTION_ID, '--args', '{"numero":"1042"}', '--confirm', 'tok.1'])).toBe(0);
        expect(h.calls).toEqual([
            {
                method: 'POST',
                path: `/v1/erp/operations/${CONNECTOR}%3Aincluir_pedido/apply`,
                body: { args: { numero: '1042' }, confirmationToken: 'tok.1' }
            }
        ]);
        expect(h.out()).toContain('Feito.');
    });

    it('shows a repeated token as the first answer, not as an error', async () => {
        const h: Harness = harness({ [APPLY]: () => applied(true) });

        expect(await run(h.context, ['erp', 'action', ACTION_ID, '--confirm', 'tok.1'])).toBe(0);
        expect(h.out()).toContain('já tinha sido aplicada');
        expect(h.out()).not.toContain('Feito.');
    });

    it('asks on a terminal: a yes applies with the token of the preview, a no changes nothing', async () => {
        const yes: Harness = harness({ [PREVIEW]: () => preview, [APPLY]: () => applied(false) }, { tty: true, stdin: 's\n' });
        expect(await run(yes.context, ['erp', 'action', ACTION_ID])).toBe(0);
        expect(yes.calls.at(-1)?.body).toEqual({ args: {}, confirmationToken: 'tok.1' });

        const no: Harness = harness({ [PREVIEW]: () => preview, [APPLY]: () => applied(false) }, { tty: true, stdin: 'n\n' });
        expect(await run(no.context, ['erp', 'action', ACTION_ID])).toBe(0);
        expect(no.calls).toHaveLength(1);
        expect(no.err()).toContain('Nada mudou.');
    });

    it('stops at the preview when the action has no token', async () => {
        const { confirmation: _token, ...without } = preview as Record<string, unknown>;
        const h: Harness = harness({ [PREVIEW]: () => ({ ...without, aviso: 'Ação sem permissão de escrita.' }) });

        expect(await run(h.context, ['erp', 'action', ACTION_ID])).toBe(0);
        expect(h.out()).toContain('Ação sem permissão de escrita.');
        expect(h.err()).toContain('nada foi aplicado');
    });

    it('prints the preview as JSON without applying', async () => {
        const h: Harness = harness({ [PREVIEW]: () => preview });

        expect(await run(h.context, ['erp', 'action', ACTION_ID, '--json'])).toBe(0);
        expect(JSON.parse(h.out())).toEqual(preview);
    });
});

describe('erp errors', () => {
    function problem(status: number, type: string, detail: string): Response {
        return json(status, { type, title: type, status, detail });
    }

    it('says not found with the hint to list, and exits non-zero', async () => {
        const h: Harness = harness({ [QUERY]: () => problem(404, 'connect.erp_operation_not_found', 'Não achei essa operação.') });

        expect(await run(h.context, ['erp', 'query', QUERY_ID])).not.toBe(0);
        expect(h.err()).toContain('Não achei essa operação.');
        expect(h.err()).toContain('nexo erp list');
    });

    it('says the company has no Nexo Connect in the plan', async () => {
        const h: Harness = harness({ [LIST]: () => problem(403, 'plans.product_not_contracted', 'Sem o Nexo Connect.') });

        expect(await run(h.context, ['erp', 'list'])).not.toBe(0);
        expect(h.err()).toContain('não tem o Nexo Connect no plano');
    });

    it('says the ERP is down and that it is the other system, not Nexo', async () => {
        const failed: Harness = harness({
            [QUERY]: () => problem(502, 'connect.operation_failed', 'A operação saldo falhou: o ERP não respondeu.')
        });
        expect(await run(failed.context, ['erp', 'query', QUERY_ID])).not.toBe(0);
        expect(failed.err()).toContain('o ERP não respondeu');
        expect(failed.err()).toContain('não do Nexo');

        const slow: Harness = harness({ [QUERY]: () => problem(504, 'connect.operation_timeout', 'Demorou demais.') });
        expect(await run(slow.context, ['erp', 'query', QUERY_ID])).not.toBe(0);
        expect(slow.err()).toContain('o Nexo está de pé');
    });
});
