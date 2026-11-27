import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { connectRehearse } from '../src/commands/connect-runs.js';
import { CredentialsStore } from '../src/config/credentials-store.js';
import type { CliContext } from '../src/context.js';
import type { FetchFunction } from '../src/http/nexo-client.js';
import { run } from '../src/run.js';

const TOKEN: string = `nexo_pat_${'b'.repeat(38)}`;
const API: string = 'https://mcp-nexo.winningsales.com.br';
const CONNECTOR: string = '019fd0a4-6b1e-7c2a-9d3f-5a8e2b7c4d10';
const LINK: string = `https://app.nexo.winningsales.com.br/settings/connectors/${CONNECTOR}`;

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
    readonly root: string;
}

type Route = (call: Call) => unknown;

function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function harness(routes: Readonly<Record<string, Route>>, stdin: string = ''): Harness {
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
        return Promise.resolve(route === undefined ? json(404, { title: 'Não encontrado', status: 404 }) : json(200, route(call)));
    };
    const context: CliContext = {
        store: new CredentialsStore(mkdtempSync(join(tmpdir(), 'nexo-connect-config-'))),
        env: { NEXO_TOKEN: TOKEN },
        stdin: Readable.from([stdin]),
        stdout,
        stderr,
        fetchFn,
        openUrl: () => Promise.resolve(false)
    };
    return { context, calls, out: () => out, err: () => err, root: mkdtempSync(join(tmpdir(), 'nexo-connect-')) };
}

function saved(seq: number): unknown {
    return {
        connectorId: CONNECTOR,
        version: { seq },
        pendingHosts: ['api.erp.example.com.br'],
        missingSecrets: ['ERP_TOKEN'],
        link: LINK
    };
}

function runOf(status: string, extra: Record<string, unknown> = {}): unknown {
    return {
        id: 'run-1',
        status,
        mode: 'dry_run',
        failureReason: null,
        counters: { read: 3 },
        plannedNexoWrites: [{ method: 'POST', host: 'nexo', path: '/company', operation: 'create', count: 3 }],
        plannedWrites: [],
        steps: [],
        error: null,
        ...extra
    };
}

describe('nexo connect init and push', () => {
    it('creates the folder with the SDK types, then creates the connector and keeps its id', async () => {
        const h: Harness = harness({ 'POST /v1/connect/connectors': () => saved(1) });
        const dir: string = join(h.root, 'clientes');

        expect(await run(h.context, ['connect', 'init', dir, '--name', 'Clientes do ERP'])).toBe(0);
        expect(readFileSync(join(dir, 'connector.ts'), 'utf8')).toContain("from './connect-sdk'");
        expect(existsSync(join(dir, 'connect-sdk.d.ts'))).toBe(true);
        expect(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))).toMatchObject({ version: 1, externalWrites: false });

        expect(await run(h.context, ['connect', 'push', dir, '-m', 'primeira versão'])).toBe(0);

        expect(h.calls[0]?.body).toMatchObject({ name: 'Clientes do ERP', summary: 'primeira versão', manifest: { version: 1 } });
        expect(JSON.parse(readFileSync(join(dir, 'nexo-connector.json'), 'utf8'))).toMatchObject({ connectorId: CONNECTOR, baseSeq: 1 });
        expect(h.out()).toContain('ERP_TOKEN');
        expect(h.out()).toContain('api.erp.example.com.br');
    });

    it('saves the next push as a new version on top of the one it came from', async () => {
        const h: Harness = harness({
            'POST /v1/connect/connectors': () => saved(1),
            [`POST /v1/connect/connectors/${CONNECTOR}/versions`]: () => saved(2)
        });
        const dir: string = join(h.root, 'c');
        await run(h.context, ['connect', 'init', dir]);
        await run(h.context, ['connect', 'push', dir, '-m', 'v1']);

        await run(h.context, ['connect', 'push', dir, '-m', 'v2']);

        expect(h.calls[1]?.path).toBe(`/v1/connect/connectors/${CONNECTOR}/versions`);
        expect(h.calls[1]?.body).toMatchObject({ baseSeq: 1, summary: 'v2' });
        expect(JSON.parse(readFileSync(join(dir, 'nexo-connector.json'), 'utf8'))).toMatchObject({ baseSeq: 2 });
    });

    it('refuses to init over a folder with files', async () => {
        const h: Harness = harness({});
        writeFileSync(join(h.root, 'x.txt'), 'x');

        expect(await run(h.context, ['connect', 'init', h.root])).toBe(2);
    });
});

describe('nexo connect pull', () => {
    it('writes the version, the SDK and the state', async () => {
        const h: Harness = harness({
            [`GET /v1/connect/connectors/${CONNECTOR}`]: () => ({
                connector: { id: CONNECTOR, name: 'Pedidos', systemId: null, headSeq: 4, publishedSeq: 3, status: 'enabled' },
                missingSecrets: [],
                pendingHosts: [],
                link: LINK
            }),
            [`GET /v1/connect/connectors/${CONNECTOR}/versions/4`]: () => ({
                seq: 4,
                code: 'export default async function run() {}',
                manifest: { version: 1 }
            })
        });
        const dir: string = join(h.root, 'pedidos');

        expect(await run(h.context, ['connect', 'pull', CONNECTOR, dir])).toBe(0);

        expect(readFileSync(join(dir, 'connector.ts'), 'utf8')).toBe('export default async function run() {}\n');
        expect(JSON.parse(readFileSync(join(dir, 'nexo-connector.json'), 'utf8'))).toEqual({
            connectorId: CONNECTOR,
            name: 'Pedidos',
            systemId: null,
            baseSeq: 4
        });
    });
});

describe('nexo connect rehearse', () => {
    it('waits for the run and shows what it would write', async () => {
        let polls: number = 0;
        const h: Harness = harness({
            [`POST /v1/connect/connectors/${CONNECTOR}/rehearsals`]: () => ({
                connectorId: CONNECTOR,
                runId: 'run-1',
                status: 'running',
                link: LINK
            }),
            [`GET /v1/connect/connectors/${CONNECTOR}/runs/run-1`]: () => {
                polls += 1;
                return runOf(polls < 2 ? 'running' : 'succeeded');
            }
        });

        await connectRehearse(h.context, undefined, { connector: CONNECTOR }, { intervalMs: 1, timeoutMs: 5000 });

        expect(h.calls[0]?.body).toEqual({ scope: 'sample' });
        expect(h.out()).toContain('succeeded (ensaio)');
        expect(h.out()).toContain('POST nexo/company (create) × 3');
    });

    it('fails with the error and the stack when the rehearsal fails', async () => {
        const h: Harness = harness({
            [`POST /v1/connect/connectors/${CONNECTOR}/rehearsals`]: () => ({
                connectorId: CONNECTOR,
                runId: 'run-1',
                status: 'running',
                link: LINK
            }),
            [`GET /v1/connect/connectors/${CONNECTOR}/runs/run-1`]: () =>
                runOf('failed', {
                    failureReason: 'code_error',
                    error: { name: 'TypeError', message: 'x is undefined', stack: 'at run (connector.ts:4)' }
                })
        });

        await expect(connectRehearse(h.context, undefined, { connector: CONNECTOR }, { intervalMs: 1, timeoutMs: 5000 })).rejects.toThrow(
            'não passou limpo'
        );
        expect(h.out()).toContain('TypeError: x is undefined');
        expect(h.out()).toContain('connector.ts:4');
    });
});

describe('risky changes and secrets', () => {
    const preview: unknown = {
        change: 'publicar',
        connectorId: CONNECTOR,
        title: 'Publicar a versão 2',
        changes: ['Roda a cada 60 minutos'],
        confirmation: { token: 'v1.tok', expiresAt: '2026-11-02T10:00:00Z' }
    };

    it('without a terminal, shows the preview and how to apply after the yes, without applying', async () => {
        const h: Harness = harness({ [`POST /v1/connect/connectors/${CONNECTOR}/publish/preview`]: () => preview });

        expect(await run(h.context, ['connect', '--connector', CONNECTOR, 'publish'])).toBe(0);

        expect(h.out()).toContain('Publicar a versão 2');
        expect(h.err()).toContain(`nexo connect publish --confirm v1.tok`);
        expect(h.calls.map((call) => call.path)).toEqual([`/v1/connect/connectors/${CONNECTOR}/publish/preview`]);
    });

    it('applies once with the confirmation token', async () => {
        const h: Harness = harness({ [`POST /v1/connect/connectors/${CONNECTOR}/publish`]: () => ({ id: CONNECTOR }) });

        expect(await run(h.context, ['connect', '--connector', CONNECTOR, 'publish', '--confirm', 'v1.tok'])).toBe(0);

        expect(h.calls).toEqual([
            { method: 'POST', path: `/v1/connect/connectors/${CONNECTOR}/publish`, body: { confirmationToken: 'v1.tok' } }
        ]);
    });

    it('does not take a secret from a pipe unless asked, and never prints it', async () => {
        const refused: Harness = harness({}, 'segredo-123');
        expect(await run(refused.context, ['connect', '--connector', CONNECTOR, 'secrets', 'set', 'ERP_TOKEN'])).toBe(2);
        expect(refused.calls).toHaveLength(0);

        const h: Harness = harness({ [`PUT /v1/connect/connectors/${CONNECTOR}/secrets/ERP_TOKEN`]: () => ({}) }, 'segredo-123\n');
        expect(await run(h.context, ['connect', '--connector', CONNECTOR, 'secrets', 'set', 'ERP_TOKEN', '--stdin'])).toBe(0);
        expect(h.calls[0]?.body).toEqual({ value: 'segredo-123' });
        expect(h.out() + h.err()).not.toContain('segredo-123');
    });
});

describe('retained records: quarantine, held writes and write hosts', () => {
    const BASE: string = `/v1/connect/connectors/${CONNECTOR}`;
    const ITEM: string = '019fd0a4-0000-7c2a-9d3f-5a8e2b7c4d11';
    const item: unknown = {
        id: ITEM,
        objectType: 'company',
        recordId: null,
        record: { values: { name: 'Acme', cnpj: '12.***.***/0001-**' }, properties: { porte: 'm' } },
        errorCode: 'invalid_cnpj',
        reason: 'CNPJ inválido',
        attempts: 2,
        status: 'open',
        runId: 'run-9'
    };
    const preview: unknown = {
        change: 'reprocessar',
        connectorId: CONNECTOR,
        title: 'Reprocessar 1 registro',
        changes: ['O registro passa de novo pelo Nexo.'],
        confirmation: { token: 'v1.rep', expiresAt: '2026-11-26T10:00:00Z' }
    };
    const withoutWrites = (h: Harness): Call[] => h.calls.filter((call) => call.method !== 'GET' && !call.path.endsWith('/preview'));

    it('lists the open records with id, object, reason, masked values and run', async () => {
        const h: Harness = harness({ [`GET ${BASE}/quarantine`]: () => [item] });

        expect(await run(h.context, ['connect', '--connector', CONNECTOR, 'quarantine'])).toBe(0);

        expect(h.out()).toContain(ITEM);
        expect(h.out()).toContain('company');
        expect(h.out()).toContain('motivo: CNPJ inválido');
        expect(h.out()).toContain('cnpj: 12.***.***/0001-**');
        expect(h.out()).toContain('execução run-9');
    });

    it('fix shows the fields and the new values, and without the yes does not call the PATCH', async () => {
        const h: Harness = harness({ [`GET ${BASE}/quarantine`]: () => [item] });

        expect(
            await run(h.context, [
                'connect',
                '--connector',
                CONNECTOR,
                'quarantine',
                'fix',
                ITEM,
                '--set',
                'cnpj=12345678000190',
                '--set',
                'properties.porte=g'
            ])
        ).toBe(0);

        expect(h.out()).toContain('cnpj: 12.***.***/0001-** → 12345678000190');
        expect(h.out()).toContain('properties.porte: m → g');
        expect(h.err()).toContain('quarantine fix');
        expect(withoutWrites(h)).toEqual([]);
        expect(h.calls.some((call) => call.method === 'PATCH')).toBe(false);
    });

    it('fix with --confirm sends the PATCH body as values and properties', async () => {
        const h: Harness = harness({ [`GET ${BASE}/quarantine`]: () => [item], [`PATCH ${BASE}/quarantine/${ITEM}`]: () => item });
        const file: string = join(h.root, 'fix.json');
        writeFileSync(file, JSON.stringify({ values: { name: 'Acme SA' } }));

        expect(
            await run(h.context, [
                'connect',
                '--connector',
                CONNECTOR,
                'quarantine',
                'fix',
                ITEM,
                '--file',
                file,
                '--set',
                'cnpj=1',
                '--confirm'
            ])
        ).toBe(0);

        expect(h.calls.at(-1)).toEqual({
            method: 'PATCH',
            path: `${BASE}/quarantine/${ITEM}`,
            body: { values: { name: 'Acme SA', cnpj: '1' }, properties: {} }
        });
    });

    it('fix shows the refusal of the /v1 in Portuguese when the field is outside the manifest', async () => {
        const refusing: Harness = harness({ [`GET ${BASE}/quarantine`]: () => [item] });
        const original: FetchFunction = refusing.context.fetchFn;
        const context: CliContext = {
            ...refusing.context,
            fetchFn: (url, init) =>
                init.method === 'PATCH'
                    ? Promise.resolve(
                          new Response(
                              JSON.stringify({
                                  title: 'Campo fora do manifesto',
                                  detail: 'O campo "foo" não é escrito pelo manifesto.',
                                  status: 422
                              }),
                              {
                                  status: 422,
                                  headers: { 'content-type': 'application/problem+json' }
                              }
                          )
                      )
                    : original(url, init)
        };

        expect(await run(context, ['connect', '--connector', CONNECTOR, 'quarantine', 'fix', ITEM, '--set', 'foo=1', '-y'])).not.toBe(0);

        expect(refusing.err()).toContain('não é escrito pelo manifesto');
    });

    it('discard shows the record and only calls the route after the yes', async () => {
        const refused: Harness = harness({ [`GET ${BASE}/quarantine`]: () => [item] });
        await run(refused.context, ['connect', '--connector', CONNECTOR, 'quarantine', 'discard', ITEM]);
        expect(refused.out()).toContain('CNPJ inválido');
        expect(withoutWrites(refused)).toEqual([]);

        const h: Harness = harness({ [`GET ${BASE}/quarantine`]: () => [item], [`POST ${BASE}/quarantine/${ITEM}/discard`]: () => item });
        expect(await run(h.context, ['connect', '--connector', CONNECTOR, 'quarantine', 'discard', ITEM, '-y'])).toBe(0);
        expect(h.calls.at(-1)).toMatchObject({ method: 'POST', path: `${BASE}/quarantine/${ITEM}/discard` });
    });

    it('reprocess shows the preview of the /v1 and applies it with the token after the yes', async () => {
        const h: Harness = harness({
            [`POST ${BASE}/quarantine/reprocess/preview`]: () => preview,
            [`POST ${BASE}/quarantine/reprocess`]: () => ({ runId: 'run-10', status: 'succeeded', resolved: 1, refused: 0, left: 0 })
        });

        await run(h.context, ['connect', '--connector', CONNECTOR, 'quarantine', 'reprocess']);
        expect(h.err()).toContain('nexo connect quarantine reprocess --confirm v1.rep');
        expect(withoutWrites(h)).toEqual([]);

        expect(await run(h.context, ['connect', '--connector', CONNECTOR, 'quarantine', 'reprocess', '--confirm', 'v1.rep'])).toBe(0);
        expect(h.calls.at(-1)).toEqual({ method: 'POST', path: `${BASE}/quarantine/reprocess`, body: { confirmationToken: 'v1.rep' } });
        expect(h.out()).toContain('Resolvidos: 1');
    });

    it('lists the held writes and the confirmed hosts', async () => {
        const h: Harness = harness({
            [`GET ${BASE}/external-writes`]: () => ({
                externalWrites: true,
                confirmed: { at: '2026-11-01T00:00:00Z', byUserId: null, hosts: ['api.erp.example.com.br'] },
                needsConfirmation: true,
                held: {
                    id: 'hw-1',
                    runId: 'run-3',
                    status: 'held',
                    method: 'POST',
                    url: 'https://api.novo.example.com.br/pedidos',
                    body: '{"n":1}',
                    failureNotice: null
                }
            })
        });

        expect(await run(h.context, ['connect', '--connector', CONNECTOR, 'writes'])).toBe(0);

        expect(h.out()).toContain('Hosts confirmados: api.erp.example.com.br');
        expect(h.out()).toContain('hw-1');
        expect(h.out()).toContain('POST https://api.novo.example.com.br/pedidos');
    });

    it('writes confirm and write-hosts confirm or revoke preview first, and apply only with the token', async () => {
        const routes: Record<string, Route> = {
            [`POST ${BASE}/external-writes/hw-1/confirm/preview`]: () => preview,
            [`POST ${BASE}/external-writes/hw-1/confirm`]: () => ({}),
            [`POST ${BASE}/write-hosts/confirm/preview`]: () => preview,
            [`POST ${BASE}/write-hosts/confirm`]: () => ({}),
            [`POST ${BASE}/write-hosts/revoke/preview`]: () => preview,
            [`POST ${BASE}/write-hosts/revoke`]: () => ({})
        };
        const h: Harness = harness(routes);

        await run(h.context, ['connect', '--connector', CONNECTOR, 'writes', 'confirm', 'hw-1']);
        await run(h.context, ['connect', '--connector', CONNECTOR, 'write-hosts', 'confirm', 'api.erp.example.com.br']);
        await run(h.context, ['connect', '--connector', CONNECTOR, 'write-hosts', 'revoke', 'api.erp.example.com.br']);
        expect(withoutWrites(h)).toEqual([]);
        expect(h.calls[1]?.body).toEqual({ host: 'api.erp.example.com.br' });

        await run(h.context, ['connect', '--connector', CONNECTOR, 'writes', 'confirm', 'hw-1', '--confirm', 'v1.rep']);
        await run(h.context, [
            'connect',
            '--connector',
            CONNECTOR,
            'write-hosts',
            'revoke',
            'api.erp.example.com.br',
            '--confirm',
            'v1.rep'
        ]);

        expect(withoutWrites(h)).toEqual([
            { method: 'POST', path: `${BASE}/external-writes/hw-1/confirm`, body: { confirmationToken: 'v1.rep' } },
            { method: 'POST', path: `${BASE}/write-hosts/revoke`, body: { host: 'api.erp.example.com.br', confirmationToken: 'v1.rep' } }
        ]);
    });
});
