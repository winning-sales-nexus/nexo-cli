import { createInterface } from 'node:readline';
import type { Interface } from 'node:readline';
import { clientOf, printJson, printLine, printNotice, sessionOf } from '../context.js';
import type { CliContext, GlobalOptions } from '../context.js';
import type { Session } from '../config/session.js';
import { usageError } from '../errors.js';
import type { ApiResponse, HttpMethod } from '../http/nexo-client.js';
import { ensureEmpty, projectDirectory } from '../connect/project.js';
import { panelFileOf, readPanelFile, readPanelState, templatePanel, writePanelFile, writePanelState } from '../dashboards/panel-file.js';
import type { PanelFile, PanelState, RemotePanel } from '../dashboards/panel-file.js';
import { operationsFor } from '../dashboards/operations.js';
import type { Operation } from '../dashboards/operations.js';

export interface DashboardOptions extends GlobalOptions {
    readonly name?: string;
    readonly summary?: string;
    readonly yes?: boolean;
    readonly text?: string;
    readonly source?: string;
    readonly limit?: string;
    readonly dashboard?: string;
}

interface Proposal {
    readonly id: string;
    readonly changes: readonly string[];
    readonly blockedReports: number;
    readonly expiresAt: string;
}

const BASE: string = '/v1/crm/dashboards';

async function call(context: CliContext, session: Session, method: HttpMethod, path: string, body?: unknown): Promise<unknown> {
    const response: ApiResponse = await clientOf(context, session).request({
        method,
        path: `${BASE}${path}`,
        ...(body === undefined ? {} : { body })
    });
    return response.body;
}

async function remotePanel(context: CliContext, session: Session, dashboardId: string): Promise<RemotePanel> {
    return ((await call(context, session, 'GET', `/${dashboardId}`)) as { panel: RemotePanel }).panel;
}

export async function dashboardsList(context: CliContext, options: DashboardOptions): Promise<void> {
    const body: { dashboards: { id: string; name: string; scope: string; reportCount: number }[] } = (await call(
        context,
        sessionOf(context, options),
        'GET',
        ''
    )) as {
        dashboards: { id: string; name: string; scope: string; reportCount: number }[];
    };
    if (options.json === true) {
        printJson(context, body);
        return;
    }
    body.dashboards.forEach((panel) => {
        printLine(context, `${panel.id}  ${panel.scope.padEnd(8)} ${String(panel.reportCount).padStart(3)} relatórios  ${panel.name}`);
    });
}

export async function dashboardsCatalog(context: CliContext, options: DashboardOptions): Promise<void> {
    const query: URLSearchParams = new URLSearchParams();
    for (const [key, value] of [
        ['text', options.text],
        ['source', options.source],
        ['limit', options.limit]
    ] as const) {
        if (value !== undefined) {
            query.set(key, value);
        }
    }
    const body: { hits: { kind: string; source: string; key: string; label: string; detail: string | null }[]; truncated: boolean } =
        (await call(context, sessionOf(context, options), 'GET', `/catalog${query.size === 0 ? '' : `?${query.toString()}`}`)) as {
            hits: { kind: string; source: string; key: string; label: string; detail: string | null }[];
            truncated: boolean;
        };
    if (options.json === true) {
        printJson(context, body);
        return;
    }
    body.hits.forEach((hit) => {
        printLine(context, `${hit.kind.padEnd(8)} ${hit.source}.${hit.key}  ${hit.label}${hit.detail === null ? '' : ` — ${hit.detail}`}`);
    });
    if (body.truncated) {
        printNotice(context, 'Há mais resultados: refine com --text ou --source.');
    }
}

export function dashboardsInit(context: CliContext, dir: string, options: DashboardOptions): void {
    const directory: string = projectDirectory(dir);
    ensureEmpty(directory);
    writePanelFile(directory, templatePanel(options.name ?? 'Novo painel'));
    writePanelState(directory, { dashboardId: null });
    printLine(context, `Painel criado em ${directory}.`);
    printNotice(
        context,
        'Busque fontes e medidas com `nexo dashboards catalog --text <termo>`, escreva os relatórios e mande com `nexo dashboards push`.'
    );
}

export async function dashboardsPull(
    context: CliContext,
    dashboardId: string,
    dir: string | undefined,
    options: DashboardOptions
): Promise<void> {
    const directory: string = projectDirectory(dir ?? dashboardId);
    ensureEmpty(directory);
    const panel: RemotePanel = await remotePanel(context, sessionOf(context, options), dashboardId);
    writePanelFile(directory, panelFileOf(panel));
    writePanelState(directory, { dashboardId });
    printLine(context, `"${panel.name}" (versão ${String(panel.headSeq)}) em ${directory}.`);
}

async function ask(context: CliContext): Promise<boolean> {
    const reader: Interface = createInterface({ input: context.stdin, output: context.stderr, terminal: true });
    try {
        const answer: string = await new Promise<string>((resolve: (text: string) => void) => {
            reader.question('Salvar? (s/N) ', resolve);
        });
        return /^(s|sim|y|yes)$/i.test(answer.trim());
    } finally {
        reader.close();
    }
}

function showProposal(context: CliContext, proposal: Proposal): void {
    printLine(context, 'Prévia (o servidor conferiu e rodou cada relatório novo ou mudado):');
    proposal.changes.forEach((change: string) => {
        printLine(context, `  - ${change}`);
    });
    if (proposal.blockedReports > 0) {
        printLine(context, `${String(proposal.blockedReports)} relatório(s) que você não vê por inteiro não entraram na prévia.`);
    }
}

async function saveProposal(context: CliContext, session: Session, directory: string | null, proposalId: string): Promise<void> {
    const panel: RemotePanel = (await call(context, session, 'POST', `/proposals/${proposalId}/save`, {})) as RemotePanel;
    if (directory !== null) {
        writePanelFile(directory, panelFileOf(panel));
        writePanelState(directory, { dashboardId: panel.id });
    }
    printLine(
        context,
        `Painel "${panel.name}" salvo, versão ${String(panel.headSeq)}.${directory === null ? '' : ' A pasta foi atualizada com os ids do Nexo.'}`
    );
}

async function decide(
    context: CliContext,
    session: Session,
    directory: string,
    proposal: Proposal,
    options: DashboardOptions
): Promise<void> {
    if (options.yes === true || (context.stdin.isTTY === true && (await ask(context)))) {
        await saveProposal(context, session, directory, proposal.id);
        return;
    }
    if (context.stdin.isTTY === true) {
        printNotice(context, 'Nada foi salvo.');
        return;
    }
    printNotice(context, `Mostre a prévia à pessoa. Depois do sim dela, salve (vale até ${proposal.expiresAt}):`);
    printNotice(context, `  nexo dashboards save ${proposal.id}${directory === projectDirectory('.') ? '' : ` ${directory}`}`);
}

export async function dashboardsPush(context: CliContext, dir: string | undefined, options: DashboardOptions): Promise<void> {
    const directory: string = projectDirectory(dir);
    const local: PanelFile = readPanelFile(directory);
    const state: PanelState = readPanelState(directory);
    const session: Session = sessionOf(context, options);
    const remote: PanelFile | null =
        state.dashboardId === null ? null : panelFileOf(await remotePanel(context, session, state.dashboardId));
    const operations: readonly Operation[] = operationsFor(local, remote);
    if (operations.length === 0) {
        printLine(context, 'O painel no Nexo já está igual à pasta.');
        return;
    }
    const summary: string = (options.summary ?? '').trim() || `Mudança pela CLI (${String(operations.length)} operações)`;
    const proposal: Proposal = (await call(context, session, 'POST', '/preview', {
        ...(state.dashboardId === null ? {} : { dashboardId: state.dashboardId }),
        summary,
        operations
    })) as Proposal;
    if (options.json === true && options.yes !== true) {
        printJson(context, { operations, proposal });
        return;
    }
    showProposal(context, proposal);
    await decide(context, session, directory, proposal, options);
}

export async function dashboardsSave(
    context: CliContext,
    proposalId: string,
    dir: string | undefined,
    options: DashboardOptions
): Promise<void> {
    if (proposalId.trim() === '') {
        throw usageError('Diga a prévia a salvar.');
    }
    await saveProposal(context, sessionOf(context, options), dir === undefined ? null : projectDirectory(dir), proposalId);
}

export async function dashboardsRun(
    context: CliContext,
    reportId: string,
    dir: string | undefined,
    options: DashboardOptions
): Promise<void> {
    const dashboardId: string | null = options.dashboard ?? readPanelState(projectDirectory(dir)).dashboardId;
    if (dashboardId === null) {
        throw usageError('Este painel ainda não foi salvo no Nexo.', 'Use --dashboard <id>, ou rode dentro da pasta de um painel salvo.');
    }
    printJson(context, await call(context, sessionOf(context, options), 'POST', `/${dashboardId}/reports/${reportId}/run`, {}));
}
