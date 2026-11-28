import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { agentPair } from '../src/commands/connect-agents.js';
import { connectBuild } from '../src/commands/connect-build.js';
import { hostsApprove } from '../src/commands/connect-hosts.js';
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
        if (route === undefined) {
            return Promise.resolve(json(404, { title: 'Não encontrado', status: 404 }));
        }
        const answer: unknown = route(call);
        return Promise.resolve(answer instanceof Response ? answer : json(200, answer));
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

    it('shows the manifest problems the /v1 lists in meta.issues when a push is refused', async () => {
        const h: Harness = harness({ 'POST /v1/connect/connectors': () => saved(1) });
        const dir: string = join(h.root, 'c');
        await run(h.context, ['connect', 'init', dir]);
        const refusing: CliContext = {
            ...h.context,
            fetchFn: () =>
                Promise.resolve(
                    new Response(
                        JSON.stringify({
                            title: 'Não foi possível concluir',
                            detail: 'O manifesto do conector tem problemas.',
                            status: 400,
                            meta: {
                                issues: [
                                    'triggers.0.at: use everyMinutes ou at, nunca os dois',
                                    { path: 'operations.x.args.0.key', message: 'use camelCase' }
                                ]
                            }
                        }),
                        { status: 400, headers: { 'content-type': 'application/problem+json' } }
                    )
                )
        };

        expect(await run(refusing, ['connect', 'push', dir, '-m', 'x'])).not.toBe(0);

        expect(h.err()).toContain('triggers.0.at: use everyMinutes ou at, nunca os dois');
        expect(h.err()).toContain('operations.x.args.0.key: use camelCase');
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
            baseSeq: 4,
            baseDigest: expect.stringMatching(/^[0-9a-f]{64}$/) as string
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
        expect(h.calls[0]).toEqual({ method: 'POST', path: `${BASE}/quarantine/reprocess/preview`, body: {} });
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

describe('versions: versions, diff and restore', () => {
    const BASE: string = `/v1/connect/connectors/${CONNECTOR}`;
    const view: unknown = {
        connector: { id: CONNECTOR, name: 'Pedidos', systemId: null, headSeq: 3, publishedSeq: 2, status: 'enabled' },
        missingSecrets: [],
        pendingHosts: [],
        link: LINK
    };
    const summary = (seq: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
        seq,
        origin: 'api',
        restoredFromSeq: null,
        summary: `versão ${String(seq)}`,
        authorUserId: '019fd0a4-aaaa-7c2a-9d3f-5a8e2b7c4d10',
        rehearsed: seq === 2,
        needsFullRehearsal: false,
        createdAt: '2026-11-20T10:00:00.000Z',
        ...extra
    });
    const files = (seq: number, code: string): unknown => ({ ...summary(seq), code, manifest: { version: 1 } });
    const routes = (): Record<string, Route> => ({
        [`GET ${BASE}`]: () => view,
        [`GET ${BASE}/versions`]: () => [summary(3), summary(2), summary(1)],
        [`GET ${BASE}/versions/1`]: () => files(1, 'old'),
        [`GET ${BASE}/versions/3`]: () => files(3, 'new'),
        [`GET ${BASE}/versions/3/diff?against=1`]: () => ({
            connectorId: CONNECTOR,
            fromSeq: 1,
            toSeq: 3,
            same: false,
            code: '-old\n+new\n',
            manifest: ''
        }),
        [`POST ${BASE}/versions/1/restore`]: () => summary(4, { origin: 'restore', restoredFromSeq: 1 })
    });
    const folder = async (h: Harness): Promise<string> => {
        const dir: string = join(h.root, 'pedidos');
        await run(h.context, ['connect', 'pull', CONNECTOR, dir, '--seq', '3']);
        return dir;
    };

    it('lists the versions with the published and the one in edit marked', async () => {
        const h: Harness = harness(routes());

        expect(await run(h.context, ['connect', '--connector', CONNECTOR, 'versions'])).toBe(0);

        const lines: string[] = h.out().trimEnd().split('\n');
        expect(lines).toHaveLength(3);
        expect(lines[0]).toContain('[em edição]');
        expect(lines[1]).toContain('[publicada, ensaio limpo]');
        expect(lines[0]).toContain('API/CLI');
        expect(lines[0]).toContain('versão 3');
    });

    it('diff 1 3 shows the code diff, and diff 1 alone goes up to the version in edit', async () => {
        const h: Harness = harness(routes());

        expect(await run(h.context, ['connect', '--connector', CONNECTOR, 'diff', '1', '3'])).toBe(0);
        expect(await run(h.context, ['connect', '--connector', CONNECTOR, 'diff', '1'])).toBe(0);

        expect(h.out()).toContain('+new');
        expect(h.calls.filter((call) => call.path.endsWith('against=1'))).toHaveLength(2);
    });

    it('restore -y writes the version as a new one and rewrites the folder', async () => {
        const h: Harness = harness({ ...routes(), [`GET ${BASE}/versions/3`]: () => files(3, 'export default 1;') });
        const dir: string = await folder(h);
        h.calls.length = 0;

        expect(await run(h.context, ['connect', 'restore', '1', dir, '-y'])).toBe(0);

        expect(h.out()).toContain('Voltar à versão 1');
        expect(h.out()).toContain('voltou como a versão 4');
        expect(h.calls.at(-1)).toMatchObject({ method: 'POST', path: `${BASE}/versions/1/restore` });
        expect(readFileSync(join(dir, 'connector.ts'), 'utf8')).toBe('old\n');
        expect(JSON.parse(readFileSync(join(dir, 'nexo-connector.json'), 'utf8'))).toMatchObject({ baseSeq: 4 });
    });

    it('restore without the yes and without a terminal shows the version and does not call the restore', async () => {
        const h: Harness = harness(routes());
        const dir: string = await folder(h);
        writeFileSync(join(dir, 'connector.ts'), 'new\n');

        await run(h.context, ['connect', 'restore', '1', dir]);

        expect(h.err()).toContain('nexo connect restore 1 --confirm');
        expect(h.calls.filter((call) => call.method === 'POST')).toEqual([]);
        expect(readFileSync(join(dir, 'connector.ts'), 'utf8')).toBe('new\n');
    });

    it('restore refuses a folder with local changes before the restore, unless --force', async () => {
        const h: Harness = harness({ ...routes(), [`GET ${BASE}/versions/3`]: () => files(3, 'new') });
        const dir: string = await folder(h);
        writeFileSync(join(dir, 'connector.ts'), 'mexi aqui\n');
        h.calls.length = 0;

        expect(await run(h.context, ['connect', 'restore', '1', dir, '-y'])).not.toBe(0);

        expect(h.err()).toContain('mudanças que não foram para o Nexo');
        expect(h.calls).toEqual([]);
        expect(readFileSync(join(dir, 'connector.ts'), 'utf8')).toBe('mexi aqui\n');

        expect(await run(h.context, ['connect', 'restore', '1', dir, '-y', '--force'])).toBe(0);
        expect(readFileSync(join(dir, 'connector.ts'), 'utf8')).toBe('old\n');
    });
});

describe('executions: run-now, initial-load and undo', () => {
    const BASE: string = `/v1/connect/connectors/${CONNECTOR}`;
    const view: unknown = {
        connector: { id: CONNECTOR, name: 'Pedidos', systemId: null, headSeq: 3, publishedSeq: 2, status: 'enabled' },
        missingSecrets: [],
        pendingHosts: [],
        link: LINK
    };
    const opened: unknown = { connectorId: CONNECTOR, runId: 'run-7', mode: 'live', status: 'running', link: `${LINK}/runs/run-7` };
    const live = (): Record<string, Route> => ({
        [`GET ${BASE}`]: () => view,
        [`POST ${BASE}/runs`]: () => opened,
        [`POST ${BASE}/initial-load`]: () => opened,
        [`GET ${BASE}/runs/run-7`]: () => runOf('succeeded', { mode: 'live' })
    });
    const posts = (h: Harness): Call[] => h.calls.filter((call) => call.method === 'POST');

    it('run-now shows what happens, and without the yes opens nothing', async () => {
        const h: Harness = harness(live());

        expect(await run(h.context, ['connect', '--connector', CONNECTOR, 'run-now'])).toBe(0);

        expect(h.out()).toContain('A versão 2 (a publicada) roda agora');
        expect(h.out()).toContain('o desfazer leva de volta');
        expect(h.err()).toContain('nexo connect run-now --confirm');
        expect(posts(h)).toEqual([]);
    });

    it('run-now -y and initial-load -y open the run and wait for it', async () => {
        const h: Harness = harness(live());

        expect(await run(h.context, ['connect', '--connector', CONNECTOR, 'run-now', '-y'])).toBe(0);
        expect(await run(h.context, ['connect', '--connector', CONNECTOR, 'initial-load', '-y'])).toBe(0);

        expect(posts(h).map((call) => call.path)).toEqual([`${BASE}/runs`, `${BASE}/initial-load`]);
        expect(h.out()).toContain('succeeded');
    });

    it('--no-wait only opens the run', async () => {
        const h: Harness = harness(live());

        expect(await run(h.context, ['connect', '--connector', CONNECTOR, 'run-now', '-y', '--no-wait'])).toBe(0);

        expect(h.out()).toContain('Execução run-7 começou');
        expect(h.calls.some((call) => call.path === `${BASE}/runs/run-7`)).toBe(false);
    });

    it('a paused connector refuses run-now in Portuguese with a non-zero exit', async () => {
        const h: Harness = harness({
            ...live(),
            [`POST ${BASE}/runs`]: () =>
                new Response(
                    JSON.stringify({
                        type: 'connect.not_enabled',
                        title: 'O conector não está ligado',
                        detail: 'Ligue o conector com `nexo connect enable` antes de rodar agora.',
                        status: 409
                    }),
                    { status: 409, headers: { 'content-type': 'application/problem+json' } }
                )
        });

        expect(await run(h.context, ['connect', '--connector', CONNECTOR, 'run-now', '-y'])).not.toBe(0);

        expect(h.err()).toContain('Ligue o conector');
    });

    it('undo shows the preview of the /v1 and only applies after the yes', async () => {
        const preview: unknown = {
            change: 'desfazer',
            connectorId: CONNECTOR,
            title: 'Desfazer a execução run-7',
            changes: ['3 registros voltam ao valor de antes.'],
            confirmation: { token: 'v1.und', expiresAt: '2026-11-26T10:00:00Z' }
        };
        const h: Harness = harness({
            [`POST ${BASE}/runs/run-7/undo/preview`]: () => preview,
            [`POST ${BASE}/runs/run-7/undo`]: () => ({ runId: 'run-7', records: 3, notice: 'O que saiu para o outro sistema fica lá.' })
        });

        await run(h.context, ['connect', '--connector', CONNECTOR, 'undo', 'run-7']);
        expect(h.out()).toContain('3 registros voltam');
        expect(h.err()).toContain('nexo connect undo run-7 --confirm v1.und');
        expect(posts(h).filter((call) => !call.path.endsWith('/preview'))).toEqual([]);

        expect(await run(h.context, ['connect', '--connector', CONNECTOR, 'undo', 'run-7', '--confirm', 'v1.und'])).toBe(0);
        expect(h.calls.at(-1)).toEqual({ method: 'POST', path: `${BASE}/runs/run-7/undo`, body: { confirmationToken: 'v1.und' } });
        expect(h.out()).toContain('Registros desfeitos: 3.');
    });

    it('rehearse --operation sends the operation and the args, and refuses args that are not JSON before calling', async () => {
        const h: Harness = harness({
            [`POST ${BASE}/rehearsals`]: () => opened,
            [`GET ${BASE}/runs/run-7`]: () => runOf('succeeded')
        });
        const file: string = join(h.root, 'args.json');
        writeFileSync(file, '{"cnpj":"123"}');

        expect(
            await run(h.context, ['connect', '--connector', CONNECTOR, 'rehearse', '--operation', 'pedidos', '--args', '{"dias":3}'])
        ).toBe(0);
        expect(
            await run(h.context, ['connect', '--connector', CONNECTOR, 'rehearse', '--operation', 'pedidos', '--args', `@${file}`])
        ).toBe(0);
        const bodies: unknown[] = posts(h).map((call) => call.body);
        expect(bodies).toEqual([
            { scope: 'sample', operation: 'pedidos', args: { dias: 3 } },
            { scope: 'sample', operation: 'pedidos', args: { cnpj: '123' } }
        ]);

        const refused: Harness = harness({});
        expect(
            await run(refused.context, ['connect', '--connector', CONNECTOR, 'rehearse', '--operation', 'x', '--args', '{nao json'])
        ).not.toBe(0);
        expect(refused.err()).toContain('não é JSON válido');
        expect(refused.calls).toEqual([]);
    });
});

describe('nexo connect rehearse --input', () => {
    const BASE: string = `/v1/connect/connectors/${CONNECTOR}`;
    const opened: unknown = { connectorId: CONNECTOR, runId: 'run-7', mode: 'dry_run', status: 'running', link: `${LINK}/runs/run-7` };
    const posts = (h: Harness): Call[] => h.calls.filter((call) => call.method === 'POST');

    it('sends the sample webhook call and refuses a malformed file before calling', async () => {
        const h: Harness = harness({
            [`POST ${BASE}/rehearsals`]: () => opened,
            [`GET ${BASE}/runs/run-7`]: () => runOf('succeeded')
        });
        const file: string = join(h.root, 'call.json');
        writeFileSync(
            file,
            JSON.stringify({ body: 'nome=Ana&fone=1199', contentType: 'application/x-www-form-urlencoded', query: { src: 'x' } })
        );
        expect(await run(h.context, ['connect', '--connector', CONNECTOR, 'rehearse', '--input', file])).toBe(0);
        expect(posts(h).map((call) => call.body)).toEqual([
            {
                scope: 'sample',
                webhook: { body: 'nome=Ana&fone=1199', contentType: 'application/x-www-form-urlencoded', query: { src: 'x' } }
            }
        ]);

        const bad: string = join(h.root, 'bad.json');
        writeFileSync(bad, JSON.stringify({ body: { a: 1 }, contentType: 'application/json' }));
        const refused: Harness = harness({});
        expect(await run(refused.context, ['connect', '--connector', CONNECTOR, 'rehearse', '--input', bad])).not.toBe(0);
        expect(refused.err()).toContain('texto cru');
        expect(await run(refused.context, ['connect', '--connector', CONNECTOR, 'rehearse', '--input', file, '--operation', 'x'])).not.toBe(
            0
        );
        expect(refused.calls).toEqual([]);
    });

    it('shows a planned Nexo step without method or operation without "undefined"', async () => {
        const h: Harness = harness({
            [`POST ${BASE}/rehearsals`]: () => opened,
            [`GET ${BASE}/runs/run-7`]: () => runOf('succeeded', { plannedNexoWrites: [{ host: 'nexo', path: 'lead', count: 2 }] })
        });
        expect(await run(h.context, ['connect', '--connector', CONNECTOR, 'rehearse'])).toBe(0);
        expect(h.out()).toContain('nexo/lead × 2');
        expect(h.out()).not.toContain('undefined');
    });
});

describe('result of a run: logs, output and quarantine', () => {
    const BASE: string = `/v1/connect/connectors/${CONNECTOR}`;
    const detailed: unknown = runOf('succeeded', {
        steps: [
            { at: '2026-11-26T10:00:01.000Z', kind: 'log', message: 'lendo pedidos', data: { page: 1, total: 40 } },
            { at: '2026-11-26T10:00:02.000Z', kind: 'nexo', target: 'company', status: 200 }
        ],
        output: { pedidos: [{ id: 1 }], total: 1 },
        plannedQuarantine: {
            total: 12,
            items: Array.from({ length: 12 }, (_, index) => ({
                object: 'company',
                externalId: `omie:${String(index)}`,
                code: 'invalid_cnpj',
                reason: 'CNPJ inválido',
                values: { cnpj: '12.***' }
            }))
        }
    });
    const routes: Record<string, Route> = { [`GET ${BASE}/runs/run-1`]: () => detailed };

    it('shows logs with data, the output and the quarantine, in that order, after the summary', async () => {
        const h: Harness = harness(routes);

        expect(await run(h.context, ['connect', '--connector', CONNECTOR, 'run', 'run-1'])).toBe(0);

        const text: string = h.out();
        expect(text).toContain('10:00:01 lendo pedidos {"page":1,"total":40}');
        const order: number[] = ['Execução run-1', 'Logs do script:', 'Resultado da operação:', 'Iriam para a quarentena (12):'].map(
            (title) => text.indexOf(title)
        );
        expect(order).toEqual([...order].sort((a, b) => a - b));
        expect(order.every((position) => position >= 0)).toBe(true);
        expect(text).toContain('company omie:0: CNPJ inválido (invalid_cnpj) {"cnpj":"12.***"}');
        expect(text.match(/company omie:/g)).toHaveLength(10);
        expect(text).toContain('… mais 2');
    });

    it('lists under "Passos com erro" only steps with an error code or a 4xx/5xx status, never a log', async () => {
        const h: Harness = harness({
            [`GET ${BASE}/runs/run-1`]: () =>
                runOf('failed', {
                    steps: [
                        { kind: 'log', message: 'só um log' },
                        { kind: 'http', target: 'GET /a', status: 200, errorCode: null, message: 'ok' },
                        { kind: 'http', target: 'GET /b', status: 200, errorCode: 'connect.blocked_address', message: 'bloqueado' },
                        { kind: 'http', target: 'GET /c', status: 404, message: 'não achou' }
                    ]
                })
        });

        await run(h.context, ['connect', '--connector', CONNECTOR, 'run', 'run-1']);

        const text: string = h.out();
        expect(text).toContain('Passos com erro:');
        expect(text).toContain('connect.blocked_address: bloqueado');
        expect(text).toContain('GET /c → 404: não achou');
        expect(text).not.toContain('GET /a');
        expect(text.slice(text.indexOf('Passos com erro:'), text.indexOf('Logs do script:'))).not.toContain('só um log');

        const onlyLogs: Harness = harness({
            [`GET ${BASE}/runs/run-1`]: () => runOf('succeeded', { steps: [{ kind: 'log', message: 'x' }] })
        });
        await run(onlyLogs.context, ['connect', '--connector', CONNECTOR, 'run', 'run-1']);
        expect(onlyLogs.out()).not.toContain('Passos com erro');
    });

    it('cuts a long output and long logs on the screen, but --json brings everything', async () => {
        const big: Harness = harness({
            [`GET ${BASE}/runs/run-1`]: () =>
                runOf('succeeded', {
                    steps: Array.from({ length: 30 }, (_, index) => ({ kind: 'log', message: `linha ${String(index)}` })),
                    output: { itens: Array.from({ length: 40 }, (_, index) => index) }
                })
        });

        await run(big.context, ['connect', '--connector', CONNECTOR, 'run', 'run-1']);
        expect(big.out()).toContain('linha 19');
        expect(big.out()).not.toContain('linha 20');
        expect(big.out()).toContain('… mais 10 logs');

        const full: Harness = harness({ [`GET ${BASE}/runs/run-1`]: () => detailed });
        await run(full.context, ['connect', '--connector', CONNECTOR, 'run', 'run-1', '--json']);
        const printed: { plannedQuarantine: { items: unknown[] }; output: unknown } = JSON.parse(full.out()) as {
            plannedQuarantine: { items: unknown[] };
            output: unknown;
        };
        expect(printed.plannedQuarantine.items).toHaveLength(12);
        expect(printed.output).toEqual({ pedidos: [{ id: 1 }], total: 1 });
    });

    it('--quiet shows only the summary, and an old answer without the fields does not break', async () => {
        const quiet: Harness = harness(routes);
        await run(quiet.context, ['connect', '--connector', CONNECTOR, 'run', 'run-1', '--quiet']);
        expect(quiet.out()).toContain('Execução run-1');
        expect(quiet.out()).not.toContain('Logs do script');
        expect(quiet.out()).not.toContain('quarentena');

        const old: Harness = harness({ [`GET ${BASE}/runs/run-1`]: () => runOf('succeeded') });
        expect(await run(old.context, ['connect', '--connector', CONNECTOR, 'run', 'run-1'])).toBe(0);
        expect(old.out()).toContain('succeeded');
        expect(old.out()).not.toContain('Logs do script');
    });
});

describe('build: the conversation with the AI of Connect', () => {
    const BASE: string = `/v1/connect/connectors/${CONNECTOR}`;
    const TURN: string = '019fd0a4-6b1e-7c2a-9d3f-5a8e2b7c4d99';
    const answered: unknown = {
        answering: false,
        messages: [
            { id: 'm1', author: 'person', kind: 'text', content: { text: 'ler os clientes do Omie' }, at: '2026-11-26T10:00:00.000Z' },
            { id: 'm2', author: 'assistant', kind: 'source', content: {}, at: '2026-11-26T10:00:05.000Z' },
            {
                id: 'm3',
                author: 'assistant',
                kind: 'version',
                content: { seq: 2, summary: 'lê os clientes' },
                at: '2026-11-26T10:00:20.000Z'
            },
            { id: 'm4', author: 'assistant', kind: 'text', content: { text: 'Escrevi o conector.' }, at: '2026-11-26T10:00:21.000Z' }
        ]
    };

    it('starts a connector outside a folder, warns about the AI allowance, waits and shows the answer', async () => {
        let polls: number = 0;
        const h: Harness = harness({
            'POST /v1/connect/build': () => ({ connectorId: CONNECTOR, turnId: TURN }),
            [`GET ${BASE}/build`]: () => {
                polls += 1;
                return polls < 2 ? { answering: true, messages: [] } : answered;
            }
        });

        await connectBuild(h.context, 'ler os clientes do Omie', h.root, {}, { intervalMs: 1, timeoutMs: 5000 });

        expect(h.calls[0]?.body).toEqual({ message: 'ler os clientes do Omie' });
        expect(h.err()).toContain('franquia de IA');
        expect(h.out()).toContain(`Conector ${CONNECTOR}, vez ${TURN}`);
        expect(h.out()).toContain('IA: Escrevi o conector.');
        expect(h.out()).toContain('escreveu a versão 2: lê os clientes');
        expect(h.out()).toContain(`nexo connect pull ${CONNECTOR}`);
    });

    it('sends the message in the conversation of the connector of the folder', async () => {
        const h: Harness = harness({
            'POST /v1/connect/connectors/other/build': () => ({ connectorId: 'other', turnId: TURN }),
            [`POST ${BASE}/build`]: () => ({ connectorId: CONNECTOR, turnId: TURN }),
            [`GET ${BASE}/build`]: () => answered,
            'POST /v1/connect/connectors': () => saved(1)
        });
        const dir: string = join(h.root, 'clientes');
        await run(h.context, ['connect', 'init', dir]);
        await run(h.context, ['connect', 'push', dir, '-m', 'primeira versão']);
        h.calls.length = 0;

        expect(await run(h.context, ['connect', 'build', 'traga também a cidade', dir])).toBe(0);

        expect(h.calls[0]).toMatchObject({ method: 'POST', path: `${BASE}/build`, body: { message: 'traga também a cidade' } });
    });

    it('keeps the connector id in an initialized folder, so the next message goes to the same conversation', async () => {
        const h: Harness = harness({
            'POST /v1/connect/build': () => ({ connectorId: CONNECTOR, turnId: TURN }),
            [`POST ${BASE}/build`]: () => ({ connectorId: CONNECTOR, turnId: TURN }),
            [`GET ${BASE}/build`]: () => answered
        });
        const dir: string = join(h.root, 'clientes');
        await run(h.context, ['connect', 'init', dir]);

        expect(await run(h.context, ['connect', 'build', 'primeiro', dir])).toBe(0);
        expect(await run(h.context, ['connect', 'build', 'segundo', dir])).toBe(0);
        expect(await run(h.context, ['connect', 'build', 'show', dir])).toBe(0);

        const posts: string[] = h.calls.filter((call) => call.method === 'POST').map((call) => call.path);
        expect(posts).toEqual(['/v1/connect/build', `${BASE}/build`]);
        expect(JSON.parse(readFileSync(join(dir, 'nexo-connector.json'), 'utf8'))).toMatchObject({ connectorId: CONNECTOR });
    });

    it('with --no-wait only sends and points to build show', async () => {
        const h: Harness = harness({ 'POST /v1/connect/build': () => ({ connectorId: CONNECTOR, turnId: TURN }) });

        expect(await run(h.context, ['connect', 'build', 'ler os clientes do Omie', h.root, '--no-wait'])).toBe(0);

        expect(h.calls).toHaveLength(1);
        expect(h.out()).toContain(`nexo connect --connector ${CONNECTOR} build show`);
    });

    it('build show prints the whole conversation', async () => {
        const h: Harness = harness({ [`GET ${BASE}/build`]: () => answered });

        expect(await run(h.context, ['connect', '--connector', CONNECTOR, 'build', 'show'])).toBe(0);

        expect(h.out()).toContain('Você: ler os clientes do Omie');
        expect(h.out()).toContain('IA: leu uma fonte');
        expect(h.out()).toContain('IA: Escrevi o conector.');
        expect(h.err()).toBe('');
    });

    it('build fix asks for the fix of a run, waits and shows the answer', async () => {
        const h: Harness = harness({
            [`POST ${BASE}/runs/run-1/fix`]: () => ({ connectorId: CONNECTOR, turnId: TURN }),
            [`GET ${BASE}/build`]: () => answered
        });

        expect(await run(h.context, ['connect', '--connector', CONNECTOR, 'build', 'fix', 'run-1', '-m', 'olhe o CNPJ'])).toBe(0);

        expect(h.calls[0]?.body).toEqual({ message: 'olhe o CNPJ' });
        expect(h.err()).toContain('franquia de IA');
        expect(h.out()).toContain('IA: Escrevi o conector.');
    });

    it('stops with the build show hint when the AI takes longer than the limit', async () => {
        const h: Harness = harness({
            'POST /v1/connect/build': () => ({ connectorId: CONNECTOR, turnId: TURN }),
            [`GET ${BASE}/build`]: () => ({ answering: true, messages: [] })
        });

        await expect(connectBuild(h.context, 'x', h.root, {}, { intervalMs: 1, timeoutMs: 20 })).rejects.toThrow('ainda está respondendo');
    });
});

describe('connector lifecycle: rename, delete and the schedule', () => {
    const ONE: string = `/v1/connect/connectors/${CONNECTOR}`;
    const detail = (extra: Record<string, unknown>): unknown => ({
        connector: { id: CONNECTOR, name: 'Clientes do ERP', systemId: null, headSeq: 1, publishedSeq: 1, status: 'enabled', ...extra },
        missingSecrets: [],
        pendingHosts: [],
        link: LINK
    });
    const me: unknown = {
        user: { name: 'Ana', email: 'ana@example.com', profiles: [] },
        company: { id: 'c1', name: 'Empresa', timezone: 'Asia/Tokyo' },
        credential: { name: 'x', expiresAt: '2027-01-01T00:00:00Z', scopes: [] }
    };
    const deletePreview: unknown = {
        change: 'apagar',
        connectorId: CONNECTOR,
        title: 'Apagar Clientes do ERP',
        changes: ['Sai das listas e para de rodar', 'Não tem volta'],
        confirmation: { token: 'v1.del', expiresAt: '2026-11-27T10:00:00Z' }
    };

    function ttyStdin(text: string): Readable & { isTTY: boolean } {
        const stream: PassThrough & { isTTY?: boolean } = new PassThrough();
        stream.isTTY = true;
        stream.end(text);
        return stream as Readable & { isTTY: boolean };
    }

    it('rename sends the PATCH and shows the old and the new name', async () => {
        let name: string = 'Clientes do ERP';
        const h: Harness = harness({
            [`GET ${ONE}`]: () => detail({ name }),
            [`PATCH ${ONE}`]: (call: Call) => {
                name = (call.body as { name: string }).name;
                return { id: CONNECTOR, name };
            },
            'GET /v1/connect/connectors': () => [{ id: CONNECTOR, name, status: 'enabled', headSeq: 1, publishedSeq: 1 }]
        });

        expect(await run(h.context, ['connect', '--connector', CONNECTOR, 'rename', 'Clientes do Omie', '--description', 'Do Omie'])).toBe(
            0
        );

        expect(h.calls.at(-1)).toEqual({ method: 'PATCH', path: ONE, body: { name: 'Clientes do Omie', description: 'Do Omie' } });
        expect(h.out()).toContain('"Clientes do ERP" -> "Clientes do Omie"');

        expect(await run(h.context, ['connect', 'list'])).toBe(0);
        expect(h.out()).toContain('Clientes do Omie');
    });

    it('rename keeps the name of the local folder in step', async () => {
        const h: Harness = harness({
            'POST /v1/connect/connectors': () => saved(1),
            [`GET ${ONE}`]: () => detail({}),
            [`PATCH ${ONE}`]: () => ({ id: CONNECTOR, name: 'Novo' })
        });
        const dir: string = join(h.root, 'c');
        await run(h.context, ['connect', 'init', dir]);
        await run(h.context, ['connect', 'push', dir, '-m', 'v1']);

        expect(await run(h.context, ['connect', 'rename', 'Novo', dir])).toBe(0);

        expect(JSON.parse(readFileSync(join(dir, 'nexo-connector.json'), 'utf8'))).toMatchObject({ name: 'Novo' });
    });

    it('delete on an enabled connector shows the refusal and the hint to pause', async () => {
        const refusing: Harness = harness({
            [`GET ${ONE}`]: () => detail({}),
            [`POST ${ONE}/delete/preview`]: () =>
                json(409, {
                    type: 'connect.pause_before_delete',
                    title: 'Conflito',
                    status: 409,
                    detail: 'Esse conector está ligado: pause antes de apagar.'
                })
        });

        expect(await run(refusing.context, ['connect', '--connector', CONNECTOR, 'delete'])).toBe(1);

        expect(refusing.err()).toContain('pause antes de apagar');
        expect(refusing.err()).toContain('nexo connect pause');
        expect(refusing.calls.some((call) => call.method === 'DELETE')).toBe(false);
    });

    it('delete only applies after the name is typed', async () => {
        const wrong: Harness = harness({
            [`GET ${ONE}`]: () => detail({ status: 'paused' }),
            [`POST ${ONE}/delete/preview`]: () => deletePreview
        });
        (wrong.context as { stdin: unknown }).stdin = ttyStdin('outro nome\n');

        expect(await run(wrong.context, ['connect', '--connector', CONNECTOR, 'delete'])).toBe(0);

        expect(wrong.out()).toContain('Apagar Clientes do ERP');
        expect(wrong.calls.some((call) => call.method === 'DELETE')).toBe(false);

        const right: Harness = harness({
            [`GET ${ONE}`]: () => detail({ status: 'paused' }),
            [`POST ${ONE}/delete/preview`]: () => deletePreview,
            [`DELETE ${ONE}`]: () => ({ connectorId: CONNECTOR, deleted: true })
        });
        (right.context as { stdin: unknown }).stdin = ttyStdin('Clientes do ERP\n');

        expect(await run(right.context, ['connect', '--connector', CONNECTOR, 'delete'])).toBe(0);

        expect(right.calls.at(-1)).toEqual({ method: 'DELETE', path: ONE, body: { confirmationToken: 'v1.del' } });
        expect(right.out()).toContain('A pasta local continua no disco');
    });

    it('delete -y is not enough without a terminal; --confirm <token> applies', async () => {
        const h: Harness = harness({
            [`GET ${ONE}`]: () => detail({ status: 'paused' }),
            [`POST ${ONE}/delete/preview`]: () => deletePreview,
            [`DELETE ${ONE}`]: () => ({ connectorId: CONNECTOR, deleted: true })
        });

        expect(await run(h.context, ['connect', '--connector', CONNECTOR, 'delete', '-y'])).not.toBe(0);
        expect(await run(h.context, ['connect', '--connector', CONNECTOR, 'delete'])).toBe(0);
        expect(h.err()).toContain('nexo connect delete --confirm v1.del');
        expect(h.calls.some((call) => call.method === 'DELETE')).toBe(false);

        expect(await run(h.context, ['connect', '--connector', CONNECTOR, 'delete', '--confirm', 'v1.del'])).toBe(0);
        expect(h.calls.at(-1)).toEqual({ method: 'DELETE', path: ONE, body: { confirmationToken: 'v1.del' } });
        expect(h.out()).toContain('A pasta local continua no disco');
    });

    it('status shows the schedule and the next run in the company time zone', async () => {
        const h: Harness = harness({
            'POST /v1/connect/connectors': () => saved(1),
            [`GET ${ONE}`]: () => detail({ schedule: 'todo dia às 08:00 e 18:00', nextRunAt: '2026-11-27T21:00:00.000Z' }),
            'GET /v1/me': () => me
        });
        const dir: string = join(h.root, 'c');
        await run(h.context, ['connect', 'init', dir]);
        await run(h.context, ['connect', 'push', dir, '-m', 'v1']);

        expect(await run(h.context, ['connect', 'status', dir])).toBe(0);

        expect(h.out()).toContain('Agenda: todo dia às 08:00 e 18:00. Próxima: 28/11 06:00.');
    });

    it('status says paused or no schedule, and an old answer without the fields does not break', async () => {
        const answers: Record<string, unknown>[] = [
            { status: 'paused', schedule: 'todo dia às 22:00', nextRunAt: null },
            { schedule: null, nextRunAt: null },
            {}
        ];
        const expected: (string | null)[] = ['Agenda: todo dia às 22:00 (pausado).', 'Agenda: sem agenda.', null];
        for (const [index, extra] of answers.entries()) {
            const h: Harness = harness({
                'POST /v1/connect/connectors': () => saved(1),
                [`GET ${ONE}`]: () => detail(extra)
            });
            const dir: string = join(h.root, 'c');
            await run(h.context, ['connect', 'init', dir]);
            await run(h.context, ['connect', 'push', dir, '-m', 'v1']);

            expect(await run(h.context, ['connect', 'status', dir])).toBe(0);

            const line: string | null = expected[index] ?? null;
            if (line === null) {
                expect(h.out()).not.toContain('Agenda');
            } else {
                expect(h.out()).toContain(line);
            }
        }
    });

    it('list shows the Próxima column, and an old answer without it prints a dash', async () => {
        const h: Harness = harness({
            'GET /v1/connect/connectors': () => [
                {
                    id: 'a',
                    name: 'Novo',
                    status: 'enabled',
                    headSeq: 1,
                    publishedSeq: 1,
                    schedule: 'todo dia às 22:00',
                    nextRunAt: '2026-11-28T01:00:00.000Z'
                },
                { id: 'b', name: 'Velho', status: 'paused', headSeq: 2, publishedSeq: 1 }
            ],
            'GET /v1/me': () => me
        });

        expect(await run(h.context, ['connect', 'list'])).toBe(0);

        const lines: string[] = h.out().trim().split('\n');
        expect(lines[0]).toContain('próxima 28/11 10:00');
        expect(lines[1]).toContain('próxima -');
    });

    it('init writes a README with both forms of the cron trigger', async () => {
        const h: Harness = harness({});
        const dir: string = join(h.root, 'c');

        await run(h.context, ['connect', 'init', dir]);

        const readme: string = readFileSync(join(dir, 'README.md'), 'utf8');
        expect(readme).toContain('"everyMinutes": 60');
        expect(readme).toContain('"at": ["08:00", "18:00"]');
    });
});

describe('nexo connect agents', () => {
    const AGENT_ID: string = '019fd0a4-0000-7000-8000-00000000a001';
    const AGENTS: string = '/v1/connect/agents';
    const PAGE: string = 'https://app.nexo.winningsales.com.br/settings/connections/connectors?tab=agent&foco=parear';

    function agentOf(extra: Record<string, unknown> = {}): Record<string, unknown> {
        return {
            id: AGENT_ID,
            name: 'SRV-MATRIZ',
            status: 'active',
            connected: true,
            agentVersion: '1.4.2',
            contractVersion: 1,
            os: 'windows',
            arch: 'x64',
            hostname: 'srv-matriz',
            reach: [
                { kind: 'http', host: '10.0.0.5', port: 8080 },
                { kind: 'sql', host: 'db.local', engine: 'sqlserver', database: 'erp' }
            ],
            lastSeenAt: '2026-11-27T10:00:00.000Z',
            connectedAt: '2026-11-27T09:00:00.000Z',
            disconnectedAt: null,
            pairedAt: '2026-11-01T10:00:00.000Z',
            revokedAt: null,
            connectors: [{ id: CONNECTOR, name: 'Clientes do ERP', status: 'enabled' }],
            ...extra
        };
    }

    function withOpener(h: Harness): { context: CliContext; opened: string[] } {
        const opened: string[] = [];
        return {
            opened,
            context: {
                ...h.context,
                sleep: () => Promise.resolve(),
                openUrl: (url: string) => {
                    opened.push(url);
                    return Promise.resolve(true);
                }
            }
        };
    }

    it('lists the agents with connection, version, last contact and connectors, and shows one with its reach', async () => {
        const h: Harness = harness({ [`GET ${AGENTS}`]: () => [agentOf()], [`GET ${AGENTS}/${AGENT_ID}`]: () => agentOf() });

        expect(await run(h.context, ['connect', 'agents'])).toBe(0);
        expect(h.out()).toContain(AGENT_ID);
        expect(h.out()).toContain('conectado');
        expect(h.out()).toContain('v1.4.2');
        expect(h.out()).toContain('2026-11-27T10:00:00.000Z');
        expect(h.out()).toContain('Clientes do ERP');

        const shown: Harness = harness({ [`GET ${AGENTS}/${AGENT_ID}`]: () => agentOf() });
        expect(await run(shown.context, ['connect', 'agents', 'show', AGENT_ID])).toBe(0);
        expect(shown.out()).toContain('http 10.0.0.5:8080');
        expect(shown.out()).toContain('sql db.local (sqlserver/erp)');
    });

    it('pair opens the tab, never asks for a code and ends on an active agent that was not in the list before', async () => {
        let polls: number = 0;
        const old: string = '2020-01-01T00:00:00.000Z';
        const h: Harness = harness({
            [`GET ${AGENTS}`]: () => {
                polls += 1;
                if (polls === 1) {
                    return [agentOf()];
                }
                if (polls === 2) {
                    return [agentOf(), agentOf({ id: 'revogado', name: 'SRV-REVOGADO', status: 'revoked', pairedAt: old })];
                }
                return [
                    agentOf(),
                    agentOf({ id: 'revogado', status: 'revoked' }),
                    agentOf({ id: 'novo', name: 'SRV-FILIAL', pairedAt: old })
                ];
            }
        });
        const { context, opened } = withOpener(h);

        expect(await run(context, ['connect', 'agents', 'pair'])).toBe(0);

        expect(opened).toEqual([PAGE]);
        expect(h.calls.some((call: Call) => call.path.includes('pairing-codes'))).toBe(false);
        expect(polls).toBe(3);
        expect(h.out()).toContain('SRV-FILIAL');
        expect(h.out()).not.toContain('SRV-MATRIZ');
        expect(h.out()).not.toContain('SRV-REVOGADO');
    });

    it('pair does not count an agent that already existed, whatever the clocks say', async () => {
        const h: Harness = harness({ [`GET ${AGENTS}`]: () => [agentOf({ pairedAt: '2099-01-01T00:00:00.000Z' })] });
        let clock: number = 0;
        const context: CliContext = {
            ...h.context,
            openUrl: () => Promise.resolve(true),
            sleep: (ms: number) => {
                clock += ms;
                return Promise.resolve();
            }
        };

        await expect(agentPair(context, {}, { intervalMs: 1000, timeoutMs: 3000, now: () => clock })).rejects.toThrow('Nenhum agente novo');
        expect(h.calls).toHaveLength(5);
    });

    it('pair does not open the browser for an API of no known environment, and refuses --code with --json', async () => {
        const h: Harness = harness({});
        const { context, opened } = withOpener(h);
        const local: CliContext = { ...context, env: { NEXO_TOKEN: TOKEN, NEXO_API_URL: 'http://localhost:3000' } };

        expect(await run(local, ['connect', 'agents', 'pair', '--no-wait'])).toBe(0);
        expect(opened).toEqual([]);
        expect(h.err()).toContain('Não conheço o app');

        expect(await run(h.context, ['connect', 'agents', 'pair', '--code', '--json'])).toBe(2);
        expect(h.calls).toEqual([]);
    });

    it('pair --no-wait only opens the tab', async () => {
        const h: Harness = harness({});
        const { context, opened } = withOpener(h);

        expect(await run(context, ['connect', 'agents', 'pair', '--no-wait'])).toBe(0);

        expect(opened).toEqual([PAGE]);
        expect(h.calls).toEqual([]);
    });

    it('pair --code asks for the code and, without the scope, points to the tab', async () => {
        const created: Harness = harness({
            [`POST ${AGENTS}/pairing-codes`]: () =>
                json(201, { code: 'ABCD-1234', expiresAt: '2026-11-27T12:00:00.000Z', name: 'SRV-NOVO', pairUrl: 'https://x' })
        });
        expect(await run(created.context, ['connect', 'agents', 'pair', '--code', '--name', 'SRV-NOVO', '--no-wait'])).toBe(0);
        expect(created.calls[0]?.body).toEqual({ name: 'SRV-NOVO' });
        expect(created.out()).toContain('ABCD-1234');

        const refused: Harness = harness({
            [`POST ${AGENTS}/pairing-codes`]: () => json(403, { title: 'Falta o escopo connectors:hosts', status: 403 })
        });
        expect(await run(refused.context, ['connect', 'agents', 'pair', '--code', '--no-wait'])).toBe(4);
        expect(refused.err()).toContain('sem --code');
    });

    it('revoke lists the machine and the dependents and only revokes after the yes', async () => {
        const routes: Record<string, Route> = {
            [`GET ${AGENTS}/${AGENT_ID}`]: () => agentOf(),
            [`POST ${AGENTS}/${AGENT_ID}/revoke`]: () => agentOf({ status: 'revoked' })
        };
        const refused: Harness = harness(routes);
        await run(refused.context, ['connect', 'agents', 'revoke', AGENT_ID]);
        expect(refused.out()).toContain('srv-matriz');
        expect(refused.out()).toContain('Clientes do ERP');
        expect(refused.out()).toContain('sem volta');
        expect(refused.calls.filter((call: Call) => call.method === 'POST')).toEqual([]);

        const h: Harness = harness(routes);
        expect(await run(h.context, ['connect', 'agents', 'revoke', AGENT_ID, '-y'])).toBe(0);
        expect(h.calls.at(-1)).toMatchObject({ method: 'POST', path: `${AGENTS}/${AGENT_ID}/revoke` });
        expect(h.out()).toContain('revogado');
    });

    it('revoke refuses an agent that is already revoked', async () => {
        const h: Harness = harness({ [`GET ${AGENTS}/${AGENT_ID}`]: () => agentOf({ status: 'revoked' }) });

        expect(await run(h.context, ['connect', 'agents', 'revoke', AGENT_ID, '-y'])).toBe(2);
        expect(h.calls.filter((call: Call) => call.method === 'POST')).toEqual([]);
    });
});

describe('nexo connect: access (hosts, secrets, webhook, OAuth, SFTP and e-mail)', () => {
    const BASE: string = `/v1/connect/connectors/${CONNECTOR}`;
    const OPTION: string[] = ['--connector', CONNECTOR];
    const SCREEN: string = `${LINK}?foco=hosts`;

    function detail(approved: string[], pending: string[]): unknown {
        return { connector: { id: CONNECTOR, name: 'Clientes do ERP', approvedHosts: approved }, pendingHosts: pending, link: LINK };
    }

    function opening(h: Harness, environment: Record<string, string> = { NEXO_TOKEN: TOKEN }): { context: CliContext; opened: string[] } {
        const opened: string[] = [];
        return {
            opened,
            context: {
                ...h.context,
                env: environment,
                sleep: () => Promise.resolve(),
                openUrl: (url: string) => {
                    opened.push(url);
                    return Promise.resolve(true);
                }
            }
        };
    }

    function approvedAfterTwoReads(): Record<string, Route> {
        let reads: number = 0;
        return {
            [`GET ${BASE}`]: () => {
                reads += 1;
                return reads < 3 ? detail([], ['api.erp.example.com.br']) : detail(['api.erp.example.com.br'], []);
            },
            [`POST ${BASE}/hosts/approve/preview`]: () => json(403, { title: 'Falta o escopo connectors:hosts', status: 403 })
        };
    }

    it('hosts shows the approved and the pending ones', async () => {
        const h: Harness = harness({ [`GET ${BASE}`]: () => detail(['api.a.com'], ['api.b.com']) });

        expect(await run(h.context, ['connect', 'hosts', ...OPTION])).toBe(0);

        expect(h.out()).toContain('Aprovados: api.a.com');
        expect(h.out()).toContain('Esperando o sim de uma pessoa: api.b.com');
    });

    it('hosts approve opens the screen on the hosts and ends when the host shows among the approved ones', async () => {
        const h: Harness = harness(approvedAfterTwoReads());
        const { context, opened } = opening(h);

        expect(await run(context, ['connect', 'hosts', 'approve', ...OPTION])).toBe(0);

        expect(opened).toEqual([SCREEN]);
        expect(h.out()).toContain('Aprovados: api.erp.example.com.br');
        expect(h.err()).toContain('receber as chamadas');
        expect(h.calls.filter((call: Call) => call.method === 'GET')).toHaveLength(3);
    });

    it('hosts approve --no-wait only opens the screen', async () => {
        const h: Harness = harness(approvedAfterTwoReads());
        const { context, opened } = opening(h);

        expect(await run(context, ['connect', 'hosts', 'approve', 'api.erp.example.com.br', '--no-wait', ...OPTION])).toBe(0);

        expect(opened).toEqual([SCREEN]);
        expect(h.calls.filter((call: Call) => call.method === 'GET')).toHaveLength(1);
    });

    it('hosts approve fails when the time runs out, by the fake clock, and refuses a host the version does not ask for', async () => {
        const h: Harness = harness({
            [`GET ${BASE}`]: () => detail([], ['api.erp.example.com.br']),
            [`POST ${BASE}/hosts/approve/preview`]: () => json(403, { title: 'Falta o escopo connectors:hosts', status: 403 })
        });
        const { context } = opening(h, { NEXO_TOKEN: TOKEN });
        let clock: number = 0;

        await expect(
            hostsApprove(context, [], { connector: CONNECTOR }, { intervalMs: 1000, timeoutMs: 3000, now: () => (clock += 1000) })
        ).rejects.toMatchObject({ exitCode: 1 });
        expect(await run(context, ['connect', 'hosts', 'approve', 'api.outro.com', ...OPTION])).toBe(2);
    });

    function typing(text: string): Readable & { isTTY: boolean } {
        const stream: PassThrough & { isTTY?: boolean } = new PassThrough();
        stream.isTTY = true;
        stream.end(text);
        return stream as Readable & { isTTY: boolean };
    }

    function withScope(): Record<string, Route> {
        return {
            ...approvedAfterTwoReads(),
            [`POST ${BASE}/hosts/approve/preview`]: () => ({
                title: 'Aprovar hosts',
                changes: ['api.erp.example.com.br'],
                confirmation: { token: 'tok-1', expiresAt: '2026-11-27T13:00:00.000Z' }
            }),
            [`POST ${BASE}/hosts/approve`]: () => detail(['api.erp.example.com.br'], [])
        };
    }

    it('hosts approve with a personal key refuses -y and --confirm, and without a terminal never calls the approval: it goes to the screen', async () => {
        const h: Harness = harness(withScope());
        const { context, opened } = opening(h);

        expect(await run(context, ['connect', 'hosts', 'approve', '-y', ...OPTION])).not.toBe(0);
        expect(await run(context, ['connect', 'hosts', 'approve', '--confirm', 'tok-1', ...OPTION])).not.toBe(0);
        expect(h.calls).toEqual([]);

        expect(await run(context, ['connect', 'hosts', 'approve', ...OPTION])).toBe(0);
        expect(opened).toEqual([SCREEN]);
        expect(h.calls.filter((call: Call) => call.path.includes('hosts/approve'))).toEqual([]);
    });

    it('hosts approve with a personal key and a terminal only applies after the person types', async () => {
        const refused: Harness = harness(withScope());
        const first: { context: CliContext; opened: string[] } = opening(refused);
        expect(await run({ ...first.context, stdin: typing('nao\n') }, ['connect', 'hosts', 'approve', ...OPTION])).toBe(0);
        expect(refused.calls.filter((call: Call) => call.method === 'POST' && call.path.endsWith('/hosts/approve'))).toEqual([]);
        expect(first.opened).toEqual([]);

        const h: Harness = harness(withScope());
        const second: { context: CliContext; opened: string[] } = opening(h);
        expect(await run({ ...second.context, stdin: typing('aprovar\n') }, ['connect', 'hosts', 'approve', ...OPTION])).toBe(0);
        expect(h.calls.at(-1)).toMatchObject({
            path: `${BASE}/hosts/approve`,
            body: { hosts: ['api.erp.example.com.br'], confirmationToken: 'tok-1' }
        });
        expect(h.err()).toContain('receber as chamadas');
        expect(h.out()).toContain('Aprovados: api.erp.example.com.br');
    });

    it('hosts approve treats a token that is not a personal key as the login one: the screen', async () => {
        const h: Harness = harness(withScope());
        const { context, opened } = opening(h, { NEXO_TOKEN: 'eyJhbGciOi.outro.token' });

        expect(await run({ ...context, stdin: typing('aprovar\n') }, ['connect', 'hosts', 'approve', ...OPTION])).toBe(0);
        expect(opened).toEqual([SCREEN]);
        expect(h.calls.filter((call: Call) => call.path.includes('hosts/approve'))).toEqual([]);
    });

    it('hosts approve never calls the approval with an OAuth token, and does not open the browser for an API it does not know', async () => {
        const h: Harness = harness(approvedAfterTwoReads());
        const store: CredentialsStore = new CredentialsStore(mkdtempSync(join(tmpdir(), 'nexo-connect-oauth-')));
        store.save('default', {
            kind: 'oauth',
            apiUrl: API,
            accessToken: 'tok',
            refreshToken: 'ref',
            expiresAt: '2099-01-01T00:00:00.000Z',
            scope: 'connectors:read',
            savedAt: '2026-11-27T00:00:00.000Z'
        });
        const { context, opened } = opening({ ...h, context: { ...h.context, store } }, {});

        expect(await run(context, ['connect', 'hosts', 'approve', ...OPTION])).toBe(0);
        expect(opened).toEqual([SCREEN]);
        expect(h.calls.filter((call: Call) => call.path.includes('hosts/approve'))).toEqual([]);

        const local: Harness = harness(approvedAfterTwoReads());
        const unknown: { context: CliContext; opened: string[] } = opening(local, {
            NEXO_TOKEN: TOKEN,
            NEXO_API_URL: 'http://localhost:3000'
        });
        const toLocal: FetchFunction = (url: string, init: RequestInit) =>
            local.context.fetchFn(url.replace('http://localhost:3000', API), init);
        expect(await run({ ...unknown.context, fetchFn: toLocal }, ['connect', 'hosts', 'approve', '--no-wait', ...OPTION])).toBe(0);
        expect(unknown.opened).toEqual([]);
    });

    it('secrets list shows names and state and never a value', async () => {
        const h: Harness = harness({
            [`GET ${BASE}/secrets`]: () => [
                { name: 'ERP_TOKEN', label: 'Token', help: null, filled: true, setAt: '2026-11-20T10:00:00.000Z' },
                { name: 'ERP_USER', label: 'Usuário', help: null, filled: false, setAt: null }
            ]
        });

        expect(await run(h.context, ['connect', 'secrets', 'list', ...OPTION])).toBe(0);

        expect(h.out()).toContain('ERP_TOKEN');
        expect(h.out()).toContain('desde 2026-11-20T10:00:00.000Z');
        expect(h.out()).toMatch(/ERP_USER\s+faltando/);
    });

    const URL_OF_HOOK: string = 'https://mcp-nexo.winningsales.com.br/hooks/abc';
    const NEW_URL: string = 'https://mcp-nexo.winningsales.com.br/hooks/novo';
    const HMAC: Record<string, unknown> = { type: 'hmac', header: 'X-Sig', secret: 'HOOK_KEY', prefix: 'sha256=' };

    it('webhook shows the address as a credential, the declared auth and the secrets still missing', async () => {
        const h: Harness = harness({
            [`GET ${BASE}/webhook`]: () => ({
                url: URL_OF_HOOK,
                auth: HMAC,
                authInEdit: { type: 'header', header: 'X-Key', secret: 'OTHER' }
            }),
            [`GET ${BASE}/secrets`]: () => [{ name: 'HOOK_KEY', filled: false, setAt: null }]
        });

        expect(await run(h.context, ['connect', 'webhook', ...OPTION])).toBe(0);

        expect(h.out()).toContain(URL_OF_HOOK);
        expect(h.out()).toContain('é a credencial');
        expect(h.out()).toContain('HMAC-SHA256');
        expect(h.out()).toContain('HMAC-SHA256 (hex) do corpo com o segredo HOOK_KEY');
        expect(h.out()).toContain('Na versão em edição');
        expect(h.out()).toContain('Falta preencher: HOOK_KEY, OTHER');
        expect(h.calls.filter((call: Call) => call.method !== 'GET')).toEqual([]);

        const asJson: Harness = harness({
            [`GET ${BASE}/webhook`]: () => ({ url: URL_OF_HOOK, auth: HMAC, authInEdit: HMAC }),
            [`GET ${BASE}/secrets`]: () => [{ name: 'HOOK_KEY', filled: false, setAt: null }]
        });
        expect(await run(asJson.context, ['connect', 'webhook', '--json', ...OPTION])).toBe(0);
        expect(JSON.parse(asJson.out())).toMatchObject({ missingSecrets: ['HOOK_KEY'], urlIsCredential: true });

        const raw: Harness = harness({ [`GET ${BASE}/webhook`]: () => ({ url: URL_OF_HOOK, auth: null, authInEdit: null }) });
        expect(await run(raw.context, ['connect', 'webhook', '--json', ...OPTION])).toBe(0);
        expect(JSON.parse(raw.out())).toEqual({
            url: URL_OF_HOOK,
            auth: null,
            authInEdit: null,
            missingSecrets: [],
            urlIsCredential: true
        });
        expect(raw.calls).toHaveLength(1);

        const bare: Harness = harness({ [`GET ${BASE}/webhook`]: () => ({ url: URL_OF_HOOK, auth: null, authInEdit: null }) });
        expect(await run(bare.context, ['connect', 'webhook', ...OPTION])).toBe(0);
        expect(bare.out()).toContain('a autenticação é o token do endereço');
        expect(bare.out()).toContain('o Nexo não exige assinatura');
        expect(bare.out()).toContain('a chamada é descartada e nada roda');
    });

    it('webhook deliveries lists the outcomes with the reason and pages with --before', async () => {
        const page: unknown = {
            deliveries: [
                {
                    receivedAt: '2026-11-27T10:00:00.000Z',
                    contentType: 'application/json',
                    sizeBytes: 12,
                    outcome: 'ran',
                    reason: null,
                    runId: 'r1',
                    runStatus: 'succeeded'
                },
                {
                    receivedAt: '2026-11-27T09:00:00.000Z',
                    contentType: null,
                    sizeBytes: 3,
                    outcome: 'refused',
                    reason: 'mismatch',
                    runId: null,
                    runStatus: null
                }
            ],
            next: '11111111-1111-4111-8111-111111111111'
        };
        const h: Harness = harness({ [`GET ${BASE}/webhook/deliveries?before=abc&limit=2`]: () => page });

        expect(await run(h.context, ['connect', 'webhook', 'deliveries', '--before', 'abc', '--limit', '2', ...OPTION])).toBe(0);

        expect(h.out()).toContain('rodou');
        expect(h.out()).toContain('execução r1 (succeeded)');
        expect(h.out()).toContain('recusada');
        expect(h.out()).toContain('motivo: a autenticação não confere');
        expect(h.out()).toContain('--before 11111111-1111-4111-8111-111111111111');

        const raw: Harness = harness({ [`GET ${BASE}/webhook/deliveries`]: () => page });
        expect(await run(raw.context, ['connect', 'webhook', 'deliveries', '--json', ...OPTION])).toBe(0);
        expect(JSON.parse(raw.out())).toEqual(page);

        const odd: Harness = harness({
            [`GET ${BASE}/webhook/deliveries`]: () => ({
                deliveries: [
                    {
                        receivedAt: '2026-11-27T10:00:00.000Z',
                        contentType: null,
                        sizeBytes: 1,
                        outcome: 'novo_desfecho',
                        reason: null,
                        runId: null,
                        runStatus: null
                    }
                ],
                next: null
            })
        });
        expect(await run(odd.context, ['connect', 'webhook', 'deliveries', ...OPTION])).toBe(0);
        expect(odd.out()).toContain('novo_desfecho');

        const bad: Harness = harness({});
        expect(await run(bad.context, ['connect', 'webhook', 'deliveries', '--limit', '500', ...OPTION])).toBe(2);
        expect(bad.calls).toEqual([]);
    });

    describe('webhook rotate', () => {
        const preview: unknown = {
            title: 'Trocar o token do webhook',
            changes: ['O endereço antigo para de valer na hora'],
            confirmation: { token: 'v1.tok', expiresAt: '2026-11-27T10:10:00.000Z' }
        };
        const renewed: unknown = { url: NEW_URL, auth: null, authInEdit: null };
        function routes(): Record<string, Route> {
            return { [`POST ${BASE}/webhook/token/preview`]: () => preview, [`POST ${BASE}/webhook/token`]: () => renewed };
        }
        function writes(h: Harness): Call[] {
            return h.calls.filter((call: Call) => call.path === `${BASE}/webhook/token`);
        }

        it('without a terminal and without --yes shows the preview, changes nothing and prints the command with the token', async () => {
            const h: Harness = harness(routes());

            expect(await run(h.context, ['connect', 'webhook', 'rotate', ...OPTION])).toBe(0);

            expect(h.out()).toContain('O endereço antigo para de valer');
            expect(h.err()).toContain('--confirm v1.tok');
            expect(writes(h)).toEqual([]);
        });

        it('answering no in a terminal changes nothing', async () => {
            const h: Harness = harness(routes());

            expect(await run({ ...h.context, stdin: typing('n\n') }, ['connect', 'webhook', 'rotate', ...OPTION])).toBe(0);

            expect(h.err()).toContain('Nada mudou.');
            expect(writes(h)).toEqual([]);
        });

        it('answering yes in a terminal renews and shows the new address as a credential', async () => {
            const h: Harness = harness(routes());

            expect(await run({ ...h.context, stdin: typing('s\n') }, ['connect', 'webhook', 'rotate', ...OPTION])).toBe(0);

            expect(writes(h)).toHaveLength(1);
            expect(writes(h)[0]?.body).toEqual({ confirmationToken: 'v1.tok' });
            expect(h.out()).toContain(`Novo endereço: ${NEW_URL}`);
            expect(h.out()).toContain('é a credencial');
        });

        it('--yes renews right after the preview; --confirm applies with the token alone', async () => {
            const yes: Harness = harness(routes());
            expect(await run(yes.context, ['connect', 'webhook', 'rotate', '--yes', ...OPTION])).toBe(0);
            expect(writes(yes)).toHaveLength(1);

            const token: Harness = harness(routes());
            expect(await run(token.context, ['connect', 'webhook', 'rotate', '--confirm', 'v1.other', ...OPTION])).toBe(0);
            expect(writes(token)[0]?.body).toEqual({ confirmationToken: 'v1.other' });
        });

        it('--json without --yes prints the preview as the only JSON and writes nothing', async () => {
            const h: Harness = harness(routes());

            expect(await run(h.context, ['connect', 'webhook', 'rotate', '--json', ...OPTION])).toBe(0);

            expect(JSON.parse(h.out())).toEqual(preview);
            expect(writes(h)).toEqual([]);
        });

        it('--json with --yes keeps stdout a single JSON: the renewed webhook; the preview goes to stderr', async () => {
            const h: Harness = harness(routes());

            expect(await run(h.context, ['connect', 'webhook', 'rotate', '--json', '--yes', ...OPTION])).toBe(0);

            expect(JSON.parse(h.out())).toEqual(renewed);
            expect(h.err()).toContain('O endereço antigo para de valer');
            expect(writes(h)).toHaveLength(1);
        });

        it('--confirm with an empty value is refused locally, with no call', async () => {
            const h: Harness = harness(routes());

            expect(await run(h.context, ['connect', 'webhook', 'rotate', '--confirm', '', ...OPTION])).toBe(2);
            expect(h.calls).toEqual([]);
        });

        it('the old webhook secret set command is gone', async () => {
            const h: Harness = harness({});

            expect(await run(h.context, ['connect', 'webhook', 'secret', 'set', '--generate', ...OPTION])).not.toBe(0);
            expect(h.calls).toEqual([]);
        });
    });

    it('oauth client set asks for the yes, takes the secret from stdin and never prints it, not even with --json', async () => {
        const routes: Record<string, Route> = {
            [`PUT ${BASE}/oauth/client`]: () => ({ required: true, app: 'own', status: 'unauthorized', clientId: 'app-1' })
        };
        const refused: Harness = harness(routes, 'segredo-do-app\n');
        expect(await run(refused.context, ['connect', 'oauth', 'client', 'set', '--client-id', 'app-1', '--stdin', ...OPTION])).toBe(0);
        expect(refused.calls).toEqual([]);
        expect(refused.err()).toContain('--confirm');
        expect(refused.err() + refused.out()).not.toContain('segredo-do-app');

        const h: Harness = harness(routes, 'segredo-do-app\n');
        expect(await run(h.context, ['connect', 'oauth', 'client', 'set', '--client-id', 'app-1', '--stdin', '-y', ...OPTION])).toBe(0);
        expect(h.calls[0]?.body).toEqual({ clientId: 'app-1', clientSecret: 'segredo-do-app' });
        expect(h.out()).toContain('derruba as autorizações');
        expect(h.err() + h.out()).not.toContain('segredo-do-app');

        const json: Harness = harness(routes, 'segredo-do-app\n');
        expect(
            await run(json.context, ['connect', 'oauth', 'client', 'set', '--client-id', 'app-1', '--stdin', '-y', '--json', ...OPTION])
        ).toBe(0);
        expect(json.err() + json.out()).not.toContain('segredo-do-app');
    });

    it('oauth client remove shows the warning and only removes after the yes', async () => {
        const routes: Record<string, Route> = {
            [`DELETE ${BASE}/oauth/client`]: () => ({ required: true, app: 'nexo', status: 'unauthorized', clientId: null })
        };
        const refused: Harness = harness(routes);
        await run(refused.context, ['connect', 'oauth', 'client', 'remove', ...OPTION]);
        expect(refused.out()).toContain('derruba as autorizações');
        expect(refused.calls).toEqual([]);

        const h: Harness = harness(routes);
        expect(await run(h.context, ['connect', 'oauth', 'client', 'remove', '--confirm', ...OPTION])).toBe(0);
        expect(h.calls.map((call: Call) => call.method)).toEqual(['DELETE']);
    });

    it('oauth shows the state; oauth authorize opens the page and ends when the state turns authorized', async () => {
        const state = (extra: Record<string, unknown>): unknown => ({
            required: true,
            app: 'nexo',
            systemName: 'Bling',
            clientId: null,
            status: 'unauthorized',
            authorizedAt: null,
            expiresAt: null,
            revokedReason: null,
            ...extra
        });
        let reads: number = 0;
        const h: Harness = harness({
            [`GET ${BASE}/oauth`]: () => {
                reads += 1;
                return reads < 3
                    ? state({})
                    : state({ status: 'authorized', authorizedAt: '2026-11-27T12:00:00.000Z', expiresAt: '2026-11-27T18:00:00.000Z' });
            },
            [`POST ${BASE}/oauth/authorize`]: () => ({
                authorizeUrl: 'https://bling.com.br/autorizar?x=1',
                expiresAt: '2026-11-27T12:10:00.000Z'
            })
        });
        const { context, opened } = opening(h);

        expect(await run(context, ['connect', 'oauth', 'authorize', ...OPTION])).toBe(0);

        expect(opened).toEqual(['https://bling.com.br/autorizar?x=1']);
        expect(h.err()).toContain('página do Nexo');
        expect(h.out()).toContain('Autorizado');

        const shown: Harness = harness({ [`GET ${BASE}/oauth`]: () => state({}) });
        expect(await run(shown.context, ['connect', 'oauth', ...OPTION])).toBe(0);
        expect(shown.out()).toContain('não autorizado');
    });

    it('oauth authorize without an app opens the screen on the OAuth step', async () => {
        const h: Harness = harness({
            [`GET ${BASE}/oauth`]: () => ({ required: true, app: 'none', status: 'unauthorized', authorizedAt: null }),
            [`POST ${BASE}/oauth/authorize`]: () => json(409, { title: 'Esse sistema ainda não tem OAuth configurado.', status: 409 }),
            [`GET ${BASE}`]: () => detail([], [])
        });
        const { context, opened } = opening(h);

        expect(await run(context, ['connect', 'oauth', 'authorize', ...OPTION])).not.toBe(0);

        expect(opened).toEqual([`${LINK}?foco=oauth`]);
    });

    it('sftp keys lists the fingerprints and sftp accept only writes after the yes', async () => {
        const routes: Record<string, Route> = {
            [`GET ${BASE}/sftp-host-keys`]: () => [
                { host: 'sftp.cliente.com.br', port: 22, fingerprint: 'SHA256:abc', pinnedAt: '2026-11-01T10:00:00.000Z' }
            ],
            [`POST ${BASE}/sftp-host-keys/accept`]: () => ({
                host: 'sftp.cliente.com.br',
                port: 22,
                fingerprint: 'SHA256:abc',
                pinnedAt: '2026-11-01T10:00:00.000Z'
            })
        };
        const listed: Harness = harness(routes);
        expect(await run(listed.context, ['connect', 'sftp', 'keys', ...OPTION])).toBe(0);
        expect(listed.out()).toContain('SHA256:abc');

        const refused: Harness = harness(routes);
        await run(refused.context, ['connect', 'sftp', 'accept', 'sftp.cliente.com.br', ...OPTION]);
        expect(refused.out()).toContain('SHA256:abc');
        expect(refused.calls.filter((call: Call) => call.method === 'POST')).toEqual([]);

        const h: Harness = harness(routes);
        expect(await run(h.context, ['connect', 'sftp', 'accept', 'sftp.cliente.com.br', '-y', ...OPTION])).toBe(0);
        expect(h.calls.at(-1)).toMatchObject({ method: 'POST', body: { host: 'sftp.cliente.com.br', port: 22 } });

        const missing: Harness = harness(routes);
        expect(await run(missing.context, ['connect', 'sftp', 'accept', 'outro.com', '-y', ...OPTION])).toBe(2);
    });

    it('email shows the address, renew only writes after the yes, and files lists the ones left out with the reason', async () => {
        const routes: Record<string, Route> = {
            [`GET ${BASE}/email`]: () => ({ address: 'antigo@in.nexo.com.br', senders: ['@cliente.com.br'] }),
            [`POST ${BASE}/email`]: () => ({ address: 'novo@in.nexo.com.br', senders: ['@cliente.com.br'] }),
            [`GET ${BASE}/email/files`]: () => [
                {
                    id: 'f1',
                    name: 'vendas.xlsx',
                    sizeBytes: 100,
                    receivedAt: '2026-11-26T10:00:00.000Z',
                    status: 'received',
                    ignoredReason: null
                },
                {
                    id: 'f2',
                    name: 'foto.png',
                    sizeBytes: 50,
                    receivedAt: '2026-11-26T11:00:00.000Z',
                    status: 'ignored',
                    ignoredReason: 'not_spreadsheet'
                }
            ]
        };
        const shown: Harness = harness(routes);
        expect(await run(shown.context, ['connect', 'email', ...OPTION])).toBe(0);
        expect(shown.out()).toContain('antigo@in.nexo.com.br');
        expect(shown.out()).toContain('@cliente.com.br');

        const refused: Harness = harness(routes);
        await run(refused.context, ['connect', 'email', 'renew', ...OPTION]);
        expect(refused.out()).toContain('para de valer');
        expect(refused.calls.filter((call: Call) => call.method === 'POST')).toEqual([]);

        const h: Harness = harness(routes);
        expect(await run(h.context, ['connect', 'email', 'renew', '-y', ...OPTION])).toBe(0);
        expect(h.out()).toContain('novo@in.nexo.com.br');

        const files: Harness = harness(routes);
        expect(await run(files.context, ['connect', 'email', 'files', ...OPTION])).toBe(0);
        expect(files.out()).toContain('vendas.xlsx');
        expect(files.out()).toContain('deixado de fora: não é planilha');
    });
});

describe('nexo connect rehearse: hosts waiting for the yes', () => {
    it('points to hosts approve', async () => {
        const h: Harness = harness({
            [`POST /v1/connect/connectors/${CONNECTOR}/rehearsals`]: () =>
                json(422, { type: 'connect.hosts_awaiting_approval', title: 'Há hosts esperando o sim', status: 422 })
        });

        expect(await run(h.context, ['connect', 'rehearse', '--connector', CONNECTOR])).not.toBe(0);
        expect(h.err()).toContain('nexo connect hosts approve');
    });
});
