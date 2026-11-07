import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { CredentialsStore } from '../src/config/credentials-store.js';
import type { CliContext } from '../src/context.js';
import type { FetchFunction } from '../src/http/nexo-client.js';
import { run } from '../src/run.js';

const API: string = 'https://mcp-nexo.winningsales.com.br';
const FLOW: string = '019fe1a2-0000-7000-8000-000000000001';
const LIVE: Record<string, unknown> = {
    schema: 1,
    name: 'Boas-vindas',
    nodes: [
        { key: 'inicio', type: 'trigger', kind: 'deal.created', config: {} },
        { key: 'aviso', type: 'action', kind: 'notify.owner', config: {}, onFailure: 'stop' },
        { key: 'fim', type: 'end', config: { outcome: 'done' } }
    ],
    edges: [
        { from: 'inicio', to: 'aviso' },
        { from: 'aviso', to: 'fim' }
    ]
};
const DOCUMENT: Record<string, unknown> = {
    schema: 1,
    name: 'Boas-vindas',
    nodes: [
        { key: 'inicio', type: 'trigger', kind: 'deal.created', config: {} },
        { key: 'tarefa', type: 'action', kind: 'task.create', config: {}, onFailure: 'stop' },
        { key: 'fim', type: 'end', config: { outcome: 'done' } }
    ],
    edges: [
        { from: 'inicio', to: 'tarefa' },
        { from: 'tarefa', to: 'fim' }
    ]
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
    readonly root: string;
}

function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function harness(routes: Readonly<Record<string, (call: Call) => unknown>>): Harness {
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
        const route: ((call: Call) => unknown) | undefined = routes[`${call.method} ${call.path}`];
        return Promise.resolve(route === undefined ? json(404, { title: 'Não encontrado', status: 404 }) : json(200, route(call)));
    };
    return {
        context: {
            store: new CredentialsStore(mkdtempSync(join(tmpdir(), 'nexo-auto-config-'))),
            env: { NEXO_TOKEN: `nexo_pat_${'c'.repeat(38)}` },
            stdin: Readable.from(['']),
            stdout,
            stderr,
            fetchFn,
            openUrl: () => Promise.resolve(false)
        },
        calls,
        out: () => out,
        err: () => err,
        root: mkdtempSync(join(tmpdir(), 'nexo-auto-'))
    };
}

const FLOW_ROW: Record<string, unknown> = {
    id: FLOW,
    name: 'Boas-vindas',
    description: null,
    state: 'draft',
    publishedSeq: null,
    reentryMode: 'every_event',
    reentryMinutes: null,
    reactsToAutomations: false
};

function working(problems: unknown[] = []): Record<string, unknown> {
    return { id: 'ver-1', seq: null, document: DOCUMENT, problems, warnings: [] };
}

describe('nexo automations push', () => {
    it('creates the automation from automation.json and shows the problems that block publishing', async () => {
        const problem: unknown = { key: 'tarefa', code: 'flows.action_unknown', reason: 'A ação task.create não existe no catálogo.' };
        const h: Harness = harness({ 'POST /v1/automations': () => ({ flow: FLOW_ROW, version: working([problem]) }) });
        const dir: string = join(h.root, 'boas-vindas');
        await run(h.context, ['automations', 'init', dir, '--name', 'Boas-vindas']);

        expect(await run(h.context, ['automations', 'push', dir, '-m', 'primeira'])).toBe(0);

        expect(h.calls[0]?.body).toMatchObject({
            name: 'Boas-vindas',
            reentryMode: 'every_event',
            summary: 'primeira',
            document: { schema: 1 }
        });
        expect(JSON.parse(readFileSync(join(dir, 'nexo-automation.json'), 'utf8'))).toEqual({ flowId: FLOW });
        expect(h.out()).toContain('passo tarefa: A ação task.create não existe no catálogo. [flows.action_unknown]');
    });

    it('saves the draft of an automation that already exists', async () => {
        const h: Harness = harness({ [`PUT /v1/automations/${FLOW}/draft`]: () => ({ flow: FLOW_ROW, version: working() }) });
        writeFileSync(join(h.root, 'automation.json'), JSON.stringify({ name: 'Boas-vindas', document: DOCUMENT }));
        writeFileSync(join(h.root, 'nexo-automation.json'), JSON.stringify({ flowId: FLOW }));

        await run(h.context, ['flows', 'push', h.root]);

        expect(h.calls[0]?.body).toEqual({ document: DOCUMENT });
        expect(h.out()).toContain('sem problemas');
    });
});

describe('nexo automations publish', () => {
    const detail = (problems: unknown[] = [], publishedSeq: number | null = 2): unknown => ({
        flow: { ...FLOW_ROW, publishedSeq },
        working: working(problems),
        versions: []
    });

    it('without a terminal, shows what goes live and does not publish', async () => {
        const h: Harness = harness({
            [`GET /v1/automations/${FLOW}`]: () => detail(),
            [`GET /v1/automations/${FLOW}/versions/2`]: () => ({ seq: 2, document: LIVE })
        });

        expect(await run(h.context, ['automations', '--automation', FLOW, 'publish'])).toBe(0);

        expect(h.out()).toContain('Substitui a versão 2');
        expect(h.out()).toContain('- Ação aviso (notify.owner)');
        expect(h.out()).toContain('+ Ação tarefa (task.create)');
        expect(h.out()).toContain('As ligações entre os passos mudaram');
        expect(h.err()).toContain('--yes');
        expect(h.calls.map((call) => call.method)).toEqual(['GET', 'GET']);
    });

    it('publishes exactly the draft it showed, after the yes', async () => {
        const h: Harness = harness({
            [`GET /v1/automations/${FLOW}`]: () => detail(),
            [`GET /v1/automations/${FLOW}/versions/2`]: () => ({ seq: 2, document: LIVE }),
            [`POST /v1/automations/${FLOW}/publish`]: () => ({ flow: FLOW_ROW })
        });

        expect(await run(h.context, ['automations', '--automation', FLOW, 'publish', '--yes', '--cancel-live-runs'])).toBe(0);

        expect(h.calls[2]?.body).toEqual({ versionId: 'ver-1', cancelLiveRuns: true });
    });

    it('refuses a draft with problems before calling publish', async () => {
        const h: Harness = harness({
            [`GET /v1/automations/${FLOW}`]: () => detail([{ key: null, code: 'flows.no_trigger', reason: 'Falta o gatilho.' }])
        });

        expect(await run(h.context, ['automations', '--automation', FLOW, 'publish', '--yes'])).toBe(1);

        expect(h.out()).toContain('regra: Falta o gatilho.');
        expect(h.calls).toHaveLength(1);
    });

    it('warns when the folder differs from the draft in the Nexo', async () => {
        const h: Harness = harness({
            [`GET /v1/automations/${FLOW}`]: () => detail(),
            [`GET /v1/automations/${FLOW}/versions/2`]: () => ({ seq: 2, document: LIVE })
        });
        writeFileSync(join(h.root, 'automation.json'), JSON.stringify({ name: 'Boas-vindas', document: { ...DOCUMENT, name: 'Outro' } }));
        writeFileSync(join(h.root, 'nexo-automation.json'), JSON.stringify({ flowId: FLOW }));

        await run(h.context, ['automations', 'publish', h.root]);

        expect(h.err()).toContain('diferente do rascunho');
    });
});
