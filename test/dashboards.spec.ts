import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { CredentialsStore } from '../src/config/credentials-store.js';
import type { CliContext } from '../src/context.js';
import { operationsFor } from '../src/dashboards/operations.js';
import type { Operation } from '../src/dashboards/operations.js';
import type { PanelFile, ReportFile, TabFile } from '../src/dashboards/panel-file.js';
import type { FetchFunction } from '../src/http/nexo-client.js';
import { run } from '../src/run.js';

const API: string = 'https://mcp-nexo.winningsales.com.br';
const PANEL: string = '019fe2b3-0000-7000-8000-000000000001';

function report(key: string, overrides: Partial<ReportFile> = {}): ReportFile {
    return {
        key,
        section: null,
        queries: [{ key: 'A', source: 'deals', measures: [{ aggregate: 'count' }] }],
        presentation: { type: 'bar', title: 'Negócios' },
        layout: { x: 0, y: 0, w: 6, h: 4 },
        audience: null,
        ...overrides
    };
}

function tab(key: string, reports: readonly ReportFile[], overrides: Partial<TabFile> = {}): TabFile {
    return { key, title: 'Vendas', variables: [], audience: null, sections: [], reports, ...overrides };
}

function panel(tabs: readonly TabFile[], overrides: Partial<PanelFile> = {}): PanelFile {
    return { name: 'Comercial', description: null, variables: [], settings: {}, tabs, ...overrides };
}

describe('operationsFor', () => {
    it('builds a new panel from scratch: panel, tab, then the report placed in the tab', () => {
        const ops: readonly Operation[] = operationsFor(panel([tab('vendas', [report('ganhos')])]), null);

        expect(ops.map((op) => op.op)).toEqual(['set_panel', 'add_tab', 'add_report']);
        expect(ops[2]).toMatchObject({ key: 'ganhos', layout: { tab: 'vendas', section: null, x: 0, w: 6 } });
    });

    it('says nothing when the folder matches the panel', () => {
        const same: PanelFile = panel([tab('t1', [report('r1')])]);

        expect(operationsFor(same, same)).toEqual([]);
    });

    it('turns edits into the smallest operations, removals first', () => {
        const before: PanelFile = panel([tab('t1', [report('r1'), report('r2')]), tab('t2', [])]);
        const after: PanelFile = panel([
            tab(
                't1',
                [
                    report('r1', { presentation: { type: 'line', title: 'Negócios' } }),
                    report('novo', { layout: { x: 6, y: 0, w: 6, h: 4 } })
                ],
                {
                    title: 'Receita',
                    sections: [{ key: 's1', title: 'Topo', collapsed: false }]
                }
            )
        ]);

        const ops: readonly Operation[] = operationsFor(after, before);

        expect(ops.map((op) => op.op)).toEqual(['remove_report', 'remove_tab', 'rename_tab', 'add_section', 'change_report', 'add_report']);
        expect(ops[0]).toEqual({ op: 'remove_report', report: 'r2' });
        expect(ops[4]).toEqual({ op: 'change_report', report: 'r1', presentation: { type: 'line', title: 'Negócios' } });
    });

    it('moves a report to another tab through its layout, and changes who sees it', () => {
        const before: PanelFile = panel([tab('t1', [report('r1')]), tab('t2', [])]);
        const after: PanelFile = panel([tab('t1', []), tab('t2', [report('r1', { audience: { roles: ['sales_lead'] } })])]);

        const ops: readonly Operation[] = operationsFor(after, before);

        expect(ops).toEqual([
            { op: 'change_report', report: 'r1', layout: { tab: 't2', section: null, x: 0, y: 0, w: 6, h: 4 } },
            { op: 'set_report_audience', report: 'r1', audience: { profiles: [], roles: ['sales_lead'] } }
        ]);
    });
});

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
        const response: Response =
            route === undefined
                ? new Response(JSON.stringify({ title: 'Não encontrado', status: 404 }), {
                      status: 404,
                      headers: { 'content-type': 'application/json' }
                  })
                : new Response(JSON.stringify(route(call)), { status: 200, headers: { 'content-type': 'application/json' } });
        return Promise.resolve(response);
    };
    const context: CliContext = {
        store: new CredentialsStore(mkdtempSync(join(tmpdir(), 'nexo-dash-config-'))),
        env: { NEXO_TOKEN: `nexo_pat_${'d'.repeat(38)}` },
        stdin: Readable.from(['']),
        stdout,
        stderr,
        fetchFn,
        openUrl: () => Promise.resolve(false)
    };
    return { context, calls, out: () => out, err: () => err, root: mkdtempSync(join(tmpdir(), 'nexo-dash-')) };
}

const SAVED: unknown = {
    id: PANEL,
    name: 'Comercial',
    description: null,
    variables: [],
    settings: {},
    headSeq: 1,
    tabs: [
        {
            id: '019fe2b3-0000-7000-8000-0000000000aa',
            title: 'Principal',
            variables: [],
            audience: null,
            sections: [],
            reports: []
        }
    ]
};

const PROPOSAL: unknown = {
    id: 'prop-1',
    changes: ['Cria o painel Comercial', 'Adiciona a aba Principal'],
    blockedReports: 0,
    expiresAt: '2026-11-02T12:00:00Z'
};

describe('nexo dashboards push and save', () => {
    it('without a terminal, previews a new panel and says how to save after the yes', async () => {
        const h: Harness = harness({ 'POST /v1/crm/dashboards/preview': () => PROPOSAL });
        const dir: string = join(h.root, 'comercial');
        await run(h.context, ['dashboards', 'init', dir, '--name', 'Comercial']);

        expect(await run(h.context, ['dashboards', 'push', dir, '-m', 'painel novo'])).toBe(0);

        expect(h.calls[0]?.body).toMatchObject({
            summary: 'painel novo',
            operations: [
                { op: 'set_panel', name: 'Comercial' },
                { op: 'add_tab', key: 'principal' }
            ]
        });
        expect((h.calls[0]?.body as Record<string, unknown>).dashboardId).toBeUndefined();
        expect(h.out()).toContain('Adiciona a aba Principal');
        expect(h.err()).toContain('nexo dashboards save prop-1');
        expect(h.calls).toHaveLength(1);
    });

    it('saves after the yes and rewrites the folder with the ids the Nexo gave', async () => {
        const h: Harness = harness({
            'POST /v1/crm/dashboards/preview': () => PROPOSAL,
            'POST /v1/crm/dashboards/proposals/prop-1/save': () => SAVED
        });
        const dir: string = join(h.root, 'comercial');
        await run(h.context, ['dashboards', 'init', dir, '--name', 'Comercial']);

        expect(await run(h.context, ['dashboards', 'push', dir, '--yes'])).toBe(0);

        expect(JSON.parse(readFileSync(join(dir, 'nexo-dashboard.json'), 'utf8'))).toEqual({ dashboardId: PANEL });
        expect((JSON.parse(readFileSync(join(dir, 'dashboard.json'), 'utf8')) as PanelFile).tabs[0]?.key).toBe(
            '019fe2b3-0000-7000-8000-0000000000aa'
        );
    });

    it('pulls a panel and finds nothing to push right after', async () => {
        const h: Harness = harness({
            [`GET /v1/crm/dashboards/${PANEL}`]: () => ({ panel: SAVED, versions: { headSeq: 1, versions: [] } })
        });
        const dir: string = join(h.root, 'baixado');

        await run(h.context, ['dashboards', 'pull', PANEL, dir]);
        await run(h.context, ['dashboards', 'push', dir]);

        expect(h.out()).toContain('já está igual');
        expect(h.calls.every((call) => call.method === 'GET')).toBe(true);
    });

    it('sends the panel id when changing one that exists', async () => {
        const h: Harness = harness({
            [`GET /v1/crm/dashboards/${PANEL}`]: () => ({ panel: SAVED }),
            'POST /v1/crm/dashboards/preview': () => PROPOSAL
        });
        writeFileSync(join(h.root, 'nexo-dashboard.json'), JSON.stringify({ dashboardId: PANEL }));
        const local: { tabs: { title: string }[] } = JSON.parse(JSON.stringify(SAVED)) as { tabs: { title: string }[] };
        const file: PanelFile = {
            name: 'Comercial',
            description: null,
            variables: [],
            settings: {},
            tabs: [tab('019fe2b3-0000-7000-8000-0000000000aa', [], { title: `${local.tabs[0]?.title ?? ''} 2026` })]
        };
        writeFileSync(join(h.root, 'dashboard.json'), JSON.stringify(file));

        await run(h.context, ['dashboards', 'push', h.root]);

        expect(h.calls[1]?.body).toMatchObject({ dashboardId: PANEL, operations: [{ op: 'rename_tab', title: 'Principal 2026' }] });
    });
});
