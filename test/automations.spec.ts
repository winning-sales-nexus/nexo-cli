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

const LEAD: Record<string, unknown> = {
    entity: 'lead',
    label: 'Lead',
    plural: 'Leads',
    sees: 'Quem alcança o registro',
    fields: [{ key: 'stage', label: 'Etapa', type: 'option' }]
};
const SUBJECT: string = '019fe1a2-0000-7000-8000-0000000000aa';

describe('nexo automations entities, events and catalog (generic triggers)', () => {
    it('lists the entities and shows one with its fields', async () => {
        const h: Harness = harness({
            'GET /v1/automations/entities': () => ({ entities: [LEAD] }),
            'GET /v1/automations/entities/lead?domain=crm': () => LEAD
        });

        expect(await run(h.context, ['automations', 'entities'])).toBe(0);
        expect(h.out()).toContain('lead  Lead (Leads)');
        expect(await run(h.context, ['automations', 'entities', 'lead', '--domain', 'crm'])).toBe(0);

        expect(h.calls.map((call) => call.path)).toEqual(['/v1/automations/entities', '/v1/automations/entities/lead?domain=crm']);
        expect(h.out()).toContain('stage');
    });

    it('prints the entities json untouched', async () => {
        const h: Harness = harness({ 'GET /v1/automations/entities': () => ({ entities: [LEAD] }) });

        await run(h.context, ['automations', 'entities', '--json']);

        expect(JSON.parse(h.out())).toEqual({ entities: [LEAD] });
    });

    it('reads the events of a record with the entity, the record and the page', async () => {
        const page: unknown = {
            events: [
                {
                    id: 'e1',
                    entity: 'lead',
                    subjectId: SUBJECT,
                    operation: 'updated',
                    changedFields: ['stage'],
                    actorKind: 'automation',
                    actorUserId: null,
                    origin: { surface: 'api', flowId: FLOW, causedByStepRunId: null },
                    occurredAt: '2026-11-07T10:00:00.000Z',
                    dispatched: true,
                    dispatchedAt: '2026-11-07T10:00:01.000Z',
                    failureCode: null
                }
            ],
            hasMore: true,
            nextCursor: 'e1',
            retentionDays: 14
        };
        const h: Harness = harness({ [`GET /v1/automations/events?entity=lead&subjectId=${SUBJECT}&limit=5`]: () => page });

        expect(await run(h.context, ['automations', 'events', 'lead', SUBJECT, '--limit', '5'])).toBe(0);

        expect(h.out()).toContain('updated');
        expect(h.out()).toContain(`automação ${FLOW}`);
        expect(h.out()).toContain('campos: stage');
        expect(h.err()).toContain('--cursor e1');
    });

    it('shows the entities and the 24 h window in the catalog', async () => {
        const catalog: unknown = {
            triggers: [{ kind: 'entidade.alterada', label: 'Entidade alterada' }],
            actions: [],
            entities: [LEAD],
            limits: { updateWindowHours: 24 }
        };
        const h: Harness = harness({ 'GET /v1/automations/catalog': () => catalog });

        await run(h.context, ['automations', 'catalog']);

        expect(h.out()).toContain('lead');
        expect(h.out()).toContain('Janela de alterações: 24 h');
    });

    it('prints a problem+json error on stderr with a failing exit code', async () => {
        const h: Harness = harness({});

        expect(await run(h.context, ['automations', 'entities', 'fatura'])).not.toBe(0);

        expect(h.err()).toContain('Não encontrado');
    });
});

describe('nexo automations get, versions, restore and the window', () => {
    it('gets an automation and lists its versions', async () => {
        const h: Harness = harness({
            [`GET /v1/automations/${FLOW}`]: () => ({ flow: FLOW_ROW, working: working(), versions: [] }),
            [`GET /v1/automations/${FLOW}/versions`]: () => ({
                versions: [
                    {
                        id: 'v',
                        seq: 2,
                        status: 'published',
                        origin: 'api',
                        restoredFromSeq: null,
                        summary: 'ajuste',
                        publishedAt: null,
                        createdAt: '2026-11-07'
                    }
                ]
            })
        });

        expect(await run(h.context, ['automations', 'get', FLOW])).toBe(0);
        expect(h.out()).toContain('Boas-vindas');
        expect(await run(h.context, ['automations', '--automation', FLOW, 'versions'])).toBe(0);

        expect(h.out()).toContain('v2');
    });

    it('restore without --yes only shows what it would do', async () => {
        const h: Harness = harness({});

        expect(await run(h.context, ['automations', '--automation', FLOW, 'restore', '2'])).toBe(0);

        expect(h.calls).toHaveLength(0);
        expect(h.err()).toContain('--yes');
    });

    it('restore with --yes posts to the version restore route', async () => {
        const h: Harness = harness({ [`POST /v1/automations/${FLOW}/versions/2/restore`]: () => ({ flow: FLOW_ROW }) });

        expect(await run(h.context, ['automations', '--automation', FLOW, 'restore', '2', '--yes', '--cancel-live-runs'])).toBe(0);

        expect(h.calls[0]?.body).toEqual({ cancelLiveRuns: true });
    });

    it('publish preview names the 24 h window for an entidade.alterada trigger', async () => {
        const document: Record<string, unknown> = {
            ...DOCUMENT,
            nodes: [{ key: 'inicio', type: 'trigger', kind: 'entidade.alterada', config: { entity: 'lead' } }]
        };
        const h: Harness = harness({
            [`GET /v1/automations/${FLOW}`]: () => ({
                flow: FLOW_ROW,
                working: { id: 'ver-1', seq: null, document, problems: [], warnings: [] },
                versions: []
            })
        });

        await run(h.context, ['automations', '--automation', FLOW, 'publish']);

        expect(h.out()).toContain('Janela de 24 h');
        expect(h.calls.map((call) => call.method)).toEqual(['GET']);
    });

    it('runs shows the window of each run', async () => {
        const runRow: unknown = {
            id: 'r1',
            state: 'completed',
            stateReason: null,
            errorCode: null,
            subject: { type: 'lead', name: 'Ana' },
            createdAt: '2026-11-07T10:00:00Z',
            suppressedUpdates: 3,
            updateWindowEndsAt: '2026-11-08T10:00:00Z'
        };
        const h: Harness = harness({ [`GET /v1/automations/${FLOW}/runs`]: () => ({ runs: [runRow] }) });

        await run(h.context, ['automations', '--automation', FLOW, 'runs']);

        expect(h.out()).toContain('janela até 2026-11-08T10:00:00Z (3 repetidas descartadas)');
    });
});
