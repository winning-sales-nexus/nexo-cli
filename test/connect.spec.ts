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
