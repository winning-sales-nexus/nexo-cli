import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { beforeEach, describe, expect, it } from 'vitest';
import { CredentialsStore } from '../src/config/credentials-store.js';
import type { CliContext } from '../src/context.js';
import type { FetchFunction } from '../src/http/nexo-client.js';
import { run } from '../src/run.js';

const API: string = 'https://mcp-nexo.winningsales.com.br';
const ROUND: string = '0192b2f0-0000-7000-8000-0000000000c1';
const AREA: string = '0192b2f0-0000-7000-8000-0000000000a1';
const STORAGE: string = 'https://storage.example/put';

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

interface Route {
    readonly status?: number;
    readonly body: unknown;
}

type Routes = Record<string, Route>;

function harness(routes: Routes): Harness {
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
        const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
        calls.push({ method, path, body });
        const route: Route = routes[`${method} ${path}`] ?? { status: 404, body: { title: 'Não encontrado' } };
        const status: number = route.status ?? 200;
        return Promise.resolve(
            new Response(status === 204 ? null : JSON.stringify(route.body), {
                status,
                headers: { 'content-type': 'application/json' }
            })
        );
    };
    const context: CliContext = {
        store: new CredentialsStore(mkdtempSync(join(tmpdir(), 'nexo-import-'))),
        env: { NEXO_TOKEN: `nexo_pat_${'d'.repeat(38)}`, NEXO_IMPORT_POLL_MS: '1' },
        stdin: Readable.from(['']),
        stdout,
        stderr,
        fetchFn,
        openUrl: () => Promise.resolve(false)
    };
    return { context, calls, out: () => out, err: () => err };
}

const ENTERED: Record<string, unknown> = {
    fileName: 'SKILL.md',
    kind: 'skill',
    name: 'follow-up',
    verdict: 'entered',
    reason: null,
    cited: null
};
const THERE: Record<string, unknown> = { ...ENTERED, verdict: 'already_there' };

function round(status: string, items: readonly unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: ROUND,
        level: 'company',
        status,
        stopReason: null,
        files: [
            { id: 'f1', fileName: 'SKILL.md', kind: 'skill', status: 'awaiting_upload', reason: null, upload: { url: `${STORAGE}/1` } },
            {
                id: 'f2',
                fileName: 'notas/contexto.txt',
                kind: 'context',
                status: 'awaiting_upload',
                reason: null,
                upload: { url: `${STORAGE}/2` }
            }
        ],
        summary: { entered: 0, repeated: 0, contradicted: 0, blocked: 0, refused: 0, unread: 0, alreadyThere: 0, items },
        ...extra
    };
}

function routesFor(final: Record<string, unknown>): Routes {
    return {
        'POST /v1/knowledge/imports': { status: 201, body: round('uploading', []) },
        [`PUT ${STORAGE}/1`]: { status: 200, body: {} },
        [`PUT ${STORAGE}/2`]: { status: 200, body: {} },
        [`POST /v1/knowledge/imports/${ROUND}/start`]: { body: round('running', []) },
        [`GET /v1/knowledge/imports/${ROUND}`]: { body: final }
    };
}

let folder: string;

beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'nexo-project-'));
    mkdirSync(join(folder, 'notas'));
    mkdirSync(join(folder, '.git'));
    writeFileSync(join(folder, 'SKILL.md'), '---\nname: follow-up\ndescription: quando escrever\n---\ncorpo');
    writeFileSync(join(folder, 'notas', 'contexto.txt'), 'contexto da empresa');
    writeFileSync(join(folder, 'foto.png'), 'png');
    writeFileSync(join(folder, '.git', 'config.md'), 'oculto');
});

describe('nexo brain import', () => {
    it('asks for the level (usage error) when there is no terminal and no --scope, and sends nothing', async () => {
        const h: Harness = harness({});

        expect(await run(h.context, ['brain', 'import', folder, '--yes'])).toBe(2);
        expect(h.err()).toContain('--scope company');
        expect(h.calls).toEqual([]);
        expect(await run(h.context, ['brain', 'import', folder, '--scope', 'area', '--yes'])).toBe(2);
        expect(h.err()).toContain('--area');
        expect(h.calls).toEqual([]);
    });

    it('lists the accepted files, warns about the ignored ones and does not send without the yes', async () => {
        const h: Harness = harness({});

        const code: number = await run(h.context, ['brain', 'import', folder, '--scope', 'company']);

        expect(code).toBe(0);
        expect(h.err()).toContain('2 arquivo(s) para mandar (1 de skill, 1 de contexto)');
        expect(h.err()).toContain('Ignorado: foto.png');
        expect(h.err()).not.toContain('.git');
        expect(h.calls).toEqual([]);
    });

    it('opens the round at the level, sends each file by its signed link, follows the state and prints the summary', async () => {
        const h: Harness = harness(
            routesFor(round('completed', [ENTERED], { summary: { ...(round('x', []).summary as object), entered: 1, items: [ENTERED] } }))
        );

        const code: number = await run(h.context, ['brain', 'import', folder, '--scope', 'area', '--area', AREA, '--yes']);

        expect(code).toBe(0);
        expect(h.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
            'POST /v1/knowledge/imports',
            `PUT ${STORAGE}/1`,
            `PUT ${STORAGE}/2`,
            `POST /v1/knowledge/imports/${ROUND}/start`,
            `GET /v1/knowledge/imports/${ROUND}`
        ]);
        expect(h.calls[0]?.body).toEqual({
            level: 'area',
            scopeId: AREA,
            files: [
                { fileName: 'notas/contexto.txt', sizeInBytes: 19, kind: 'context' },
                { fileName: 'SKILL.md', sizeInBytes: 58, kind: 'skill' }
            ]
        });
        expect(h.out()).toContain('Entraram 1');
        expect(h.out()).toContain('entrou: SKILL.md - follow-up');
    });

    it('prints the raw summary with --json', async () => {
        const summary: Record<string, unknown> = {
            entered: 1,
            repeated: 0,
            contradicted: 0,
            blocked: 0,
            refused: 0,
            unread: 0,
            alreadyThere: 0,
            items: [ENTERED]
        };
        const h: Harness = harness(routesFor(round('completed', [ENTERED], { summary })));

        expect(await run(h.context, ['brain', 'import', folder, '--scope', 'company', '--yes', '--json'])).toBe(0);

        expect(JSON.parse(h.out())).toEqual(summary);
        expect(h.calls[0]?.body).not.toHaveProperty('scopeId');
    });

    it('turns a 403 into the admin-only message', async () => {
        const h: Harness = harness({
            'POST /v1/knowledge/imports': { status: 403, body: { title: 'Forbidden', status: 403, detail: 'sem perfil' } }
        });

        const code: number = await run(h.context, ['brain', 'import', folder, '--scope', 'company', '--yes']);

        expect(code).toBe(4);
        expect(h.err()).toContain('só de admin');
    });

    it('exits non-zero when the round stops, after printing the summary', async () => {
        const h: Harness = harness(routesFor(round('stopped', [ENTERED], { stopReason: 'budget' })));

        const code: number = await run(h.context, ['brain', 'import', folder, '--scope', 'company', '--yes']);

        expect(code).toBe(1);
        expect(h.err()).toContain('budget');
        expect(h.out()).toContain('Entraram');
    });

    it('shows "já estava" for every piece on the second round over the same folder', async () => {
        const h: Harness = harness(
            routesFor(round('completed', [THERE, { ...THERE, fileName: 'notas/contexto.txt', kind: 'context', name: 'contexto' }]))
        );

        expect(await run(h.context, ['brain', 'import', folder, '--scope', 'company', '--yes'])).toBe(0);

        expect(h.out().match(/já estava:/g)).toHaveLength(2);
    });
});
