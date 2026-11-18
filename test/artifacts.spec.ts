import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { CredentialsStore } from '../src/config/credentials-store.js';
import type { CliContext } from '../src/context.js';
import type { FetchFunction } from '../src/http/nexo-client.js';
import { run } from '../src/run.js';

const API: string = 'https://mcp-nexo.winningsales.com.br';
const DEAL: string = '0192b2f0-0000-7000-8000-0000000000d1';
const ARTIFACT: string = '0192b2f0-0000-7000-8000-0000000000a1';

const VERSION: Record<string, unknown> = {
    version: 2,
    fileName: 'analise.html',
    source: 'generated',
    aiState: 'written',
    createdAt: '2026-11-17T10:00:00Z'
};
const ITEM: Record<string, unknown> = {
    id: ARTIFACT,
    name: 'Análise do negócio · Acme',
    kind: 'analysis',
    dealId: DEAL,
    ownerName: 'Rui Vendedor',
    currentVersion: 2,
    current: VERSION,
    updatedAt: '2026-11-17T10:00:00Z'
};
const GENERATED: unknown = {
    artifact: ITEM,
    version: VERSION,
    aiState: 'written',
    generatedAt: '2026-11-17T10:00:00Z',
    saved: true
};
const CONTENT: unknown = {
    artifactId: ARTIFACT,
    version: 2,
    mimeType: 'text/html',
    fileName: 'analise.html',
    storage: 's3',
    sizeInBytes: 2048,
    content: null,
    download: { url: 'https://files.test/download', expiresAt: '2026-11-17T10:05:00Z' },
    view: { url: 'https://files.test/view', expiresAt: '2026-11-17T10:05:00Z' }
};

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

function harness(routes: Readonly<Record<string, { status?: number; body: unknown }>>): Harness {
    const calls: Call[] = [];
    const stdout: PassThrough = new PassThrough();
    const stderr: PassThrough = new PassThrough();
    let out: string = '';
    let err: string = '';
    stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    stderr.on('data', (chunk: Buffer) => (err += chunk.toString()));
    const fetchFn: FetchFunction = (url: string, init?: RequestInit) => {
        const path: string = url.replace(API, '');
        const method: string = init?.method ?? 'GET';
        calls.push({ method, path, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
        const route: { status?: number; body: unknown } = routes[`${method} ${path}`] ?? {
            status: 404,
            body: { title: 'Não encontrado', status: 404 }
        };
        return Promise.resolve(
            new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers: { 'content-type': 'application/json' } })
        );
    };
    const context: CliContext = {
        store: new CredentialsStore(mkdtempSync(join(tmpdir(), 'nexo-artifacts-'))),
        env: { NEXO_TOKEN: `nexo_pat_${'d'.repeat(38)}` },
        stdin: Readable.from(['']),
        stdout,
        stderr,
        fetchFn,
        openUrl: () => Promise.resolve(false)
    };
    return { context, calls, out: () => out, err: () => err };
}

const GENERATE: string = `POST /v1/deals/${DEAL}/analysis`;
const CONTENT_PATH: string = `GET /v1/artifacts/${ARTIFACT}/versions/2/content`;

describe('nexo deals analysis', () => {
    it('generates the analysis, then reads the version to print the view link and the aiState', async () => {
        const h: Harness = harness({ [GENERATE]: { status: 201, body: GENERATED }, [CONTENT_PATH]: { body: CONTENT } });

        expect(await run(h.context, ['deals', 'analysis', DEAL, '--brief', ' o que trava o fechamento '])).toBe(0);

        expect(h.calls.map((call: Call) => `${call.method} ${call.path}`)).toEqual([GENERATE, CONTENT_PATH]);
        expect(h.calls[0]?.body).toEqual({ brief: 'o que trava o fechamento' });
        expect(h.out()).toContain('Análise do negócio · Acme: versão 2');
        expect(h.out()).toContain('aiState: written (a IA escreveu a página)');
        expect(h.out()).toContain('view: https://files.test/view');
    });

    it('answers to the Portuguese aliases, sends an empty body without --brief and warns when nothing was saved', async () => {
        const unsaved: unknown = { ...(GENERATED as Record<string, unknown>), aiState: 'fallback_budget', saved: false };
        const h: Harness = harness({ [GENERATE]: { status: 201, body: unsaved }, [CONTENT_PATH]: { body: CONTENT } });

        expect(await run(h.context, ['negocios', 'analise', DEAL])).toBe(0);

        expect(h.calls[0]?.body).toEqual({});
        expect(h.out()).toContain('aiState: fallback_budget');
        expect(h.err()).toContain('Nada foi gravado');
    });

    it('prints the answer with the links with --json', async () => {
        const h: Harness = harness({ [GENERATE]: { status: 201, body: GENERATED }, [CONTENT_PATH]: { body: CONTENT } });

        expect(await run(h.context, ['--json', 'deals', 'analysis', DEAL])).toBe(0);

        const printed: { aiState: string; view: { url: string } } = JSON.parse(h.out()) as { aiState: string; view: { url: string } };
        expect(printed.aiState).toBe('written');
        expect(printed.view.url).toBe('https://files.test/view');
    });

    it('fails with the API problem when the deal is not visible', async () => {
        const h: Harness = harness({});

        expect(await run(h.context, ['deals', 'analysis', DEAL])).not.toBe(0);
        expect(h.out()).toBe('');
    });
});

describe('nexo artifacts', () => {
    it('lists the artifacts of a deal with the kind filter', async () => {
        const path: string = `/v1/artifacts?dealId=${DEAL}&kind=analysis`;
        const h: Harness = harness({
            [`GET ${path}`]: { body: { data: [ITEM], pagination: { page: 1, pageSize: 20, totalRecords: 1, totalPages: 1 } } }
        });

        expect(await run(h.context, ['artefatos', 'list', '--deal', DEAL, '--kind', 'analysis'])).toBe(0);

        expect(h.calls[0]?.path).toBe(path);
        expect(h.out()).toContain(`${ARTIFACT}  analysis  v2  written`);
        expect(h.out()).toContain('Análise do negócio · Acme');
    });

    it('needs --deal and says when the deal has no artifact', async () => {
        const empty: Harness = harness({
            [`GET /v1/artifacts?dealId=${DEAL}`]: {
                body: { data: [], pagination: { page: 1, pageSize: 20, totalRecords: 0, totalPages: 0 } }
            }
        });

        expect(await run(empty.context, ['artifacts', 'list'])).not.toBe(0);
        expect(empty.calls).toHaveLength(0);
        expect(await run(empty.context, ['artifacts', 'list', '--deal', DEAL])).toBe(0);
        expect(empty.out()).toContain('Nenhum artefato neste negócio.');
    });

    it('opens an artifact with its versions', async () => {
        const detail: unknown = { ...ITEM, versions: [VERSION, { ...VERSION, version: 1, aiState: 'fallback_invalid' }] };
        const h: Harness = harness({ [`GET /v1/artifacts/${ARTIFACT}`]: { body: detail } });

        expect(await run(h.context, ['artifacts', 'get', ARTIFACT])).toBe(0);

        expect(h.out()).toContain('Análise do negócio · Acme (analysis), versão atual 2');
        expect(h.out()).toContain('v2  generated  written');
        expect(h.out()).toContain('v1  generated  fallback_invalid');
    });

    it('reads one version with the signed links, and refuses a version that is not a number', async () => {
        const h: Harness = harness({ [CONTENT_PATH]: { body: CONTENT } });

        expect(await run(h.context, ['artifacts', 'get', ARTIFACT, '--version-number', '2'])).toBe(0);
        expect(h.out()).toContain('Versão 2: analise.html (text/html, 2048 bytes, s3)');
        expect(h.out()).toContain('view: https://files.test/view');
        expect(h.out()).toContain('download: https://files.test/download');

        expect(await run(h.context, ['artifacts', 'get', ARTIFACT, '--version-number', 'x'])).not.toBe(0);
        expect(h.calls).toHaveLength(1);
    });

    it('prints inline text content', async () => {
        const inline: unknown = {
            ...(CONTENT as Record<string, unknown>),
            storage: 'inline',
            content: 'texto da versão',
            view: null,
            download: null
        };
        const h: Harness = harness({ [CONTENT_PATH]: { body: inline } });

        expect(await run(h.context, ['artifacts', 'get', ARTIFACT, '--version-number', '2'])).toBe(0);
        expect(h.out()).toContain('texto da versão');
    });
});
