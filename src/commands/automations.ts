import { createInterface } from 'node:readline';
import type { Interface } from 'node:readline';
import { clientOf, printJson, printLine, printNotice, sessionOf } from '../context.js';
import type { CliContext, GlobalOptions } from '../context.js';
import type { Session } from '../config/session.js';
import { CliError, usageError } from '../errors.js';
import { EXIT_CODES } from '../exit-codes.types.js';
import type { ApiResponse } from '../http/nexo-client.js';
import { ensureEmpty, projectDirectory } from '../connect/project.js';
import { readAutomation, readAutomationState, templateAutomation, writeAutomation, writeAutomationState } from '../automations/project.js';
import type { AutomationSettings, AutomationState } from '../automations/project.js';
import { describeDiff, describeDocument, describeProblems, sameDocument } from '../automations/summary.js';
import type { FlowProblem } from '../automations/summary.js';

export interface AutomationOptions extends GlobalOptions {
    readonly automation?: string;
    readonly name?: string;
    readonly summary?: string;
    readonly yes?: boolean;
    readonly cancelLiveRuns?: boolean;
    readonly state?: string;
    readonly domain?: string;
    readonly subject?: string;
    readonly limit?: string;
    readonly cursor?: string;
}

interface WorkingVersion {
    readonly id: string;
    readonly document: Record<string, unknown>;
    readonly problems: readonly FlowProblem[];
}

interface FlowRow {
    readonly id: string;
    readonly name: string;
    readonly description: string | null;
    readonly state: string;
    readonly publishedSeq: number | null;
    readonly reentryMode: AutomationSettings['reentryMode'];
    readonly reentryMinutes: number | null;
    readonly reactsToAutomations: boolean;
}

interface FlowDetail {
    readonly flow: FlowRow;
    readonly working: WorkingVersion | null;
}

interface EntityDef {
    readonly entity: string;
    readonly label: string;
    readonly plural: string;
    readonly sees: string;
    readonly fields: readonly {
        readonly key: string;
        readonly label: string;
        readonly type: string;
        readonly options?: readonly unknown[];
    }[];
}

interface EntityEvent {
    readonly id: string;
    readonly entity: string;
    readonly subjectId: string;
    readonly operation: string;
    readonly changedFields: readonly string[];
    readonly actorKind: string;
    readonly origin: { readonly surface: string | null; readonly flowId: string | null };
    readonly occurredAt: string;
    readonly dispatched: boolean;
    readonly failureCode: string | null;
}

interface EventPage {
    readonly events: readonly EntityEvent[];
    readonly hasMore: boolean;
    readonly nextCursor: string | null;
    readonly retentionDays: number;
}

interface VersionRow {
    readonly seq: number | null;
    readonly status: string;
    readonly origin: string;
    readonly restoredFromSeq: number | null;
    readonly summary: string | null;
    readonly publishedAt: string | null;
    readonly createdAt: string;
}

const BASE: string = '/v1/automations';
const UPDATE_WINDOW_HOURS: number = 24;

async function call(context: CliContext, session: Session, method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<unknown> {
    const response: ApiResponse = await clientOf(context, session).request({
        method,
        path: `${BASE}${path}`,
        ...(body === undefined ? {} : { body })
    });
    return response.body;
}

function flowIdOf(options: AutomationOptions, dir: string | undefined): string {
    const flowId: string | null = options.automation ?? readAutomationState(projectDirectory(dir)).flowId;
    if (flowId === null) {
        throw usageError('Esta automação ainda não foi enviada ao Nexo.', 'Suba com `nexo automations push -m "primeira versão"`.');
    }
    return flowId;
}

export async function automationsCatalog(context: CliContext, options: AutomationOptions): Promise<void> {
    const catalog: unknown = await call(context, sessionOf(context, options), 'GET', '/catalog');
    if (options.json === true) {
        printJson(context, catalog);
        return;
    }
    const { triggers, actions, entities, limits } = catalog as {
        triggers: { kind: string; label: string; configHint?: string }[];
        actions: { kind: string; label: string; risk: string; configHint?: string }[];
        entities?: EntityDef[];
        limits?: { updateWindowHours?: number };
    };
    printCatalogKinds(context, triggers, actions);
    printCatalogEntities(context, entities, limits);
}

function printCatalogKinds(
    context: CliContext,
    triggers: readonly { kind: string; label: string; configHint?: string }[],
    actions: readonly { kind: string; label: string; risk: string; configHint?: string }[]
): void {
    printLine(context, 'Gatilhos:');
    triggers.forEach((trigger) => {
        printLine(
            context,
            `  ${trigger.kind.padEnd(32)} ${trigger.label}${trigger.configHint === undefined ? '' : ` — ${trigger.configHint}`}`
        );
    });
    printLine(context, 'Ações:');
    actions.forEach((action) => {
        printLine(
            context,
            `  ${action.kind.padEnd(32)} ${action.label} [${action.risk}]${action.configHint === undefined ? '' : ` — ${action.configHint}`}`
        );
    });
}

function printCatalogEntities(
    context: CliContext,
    entities: readonly EntityDef[] | undefined,
    limits: { updateWindowHours?: number } | undefined
): void {
    if (entities !== undefined && entities.length > 0) {
        printLine(context, 'Entidades que os gatilhos entidade.criada, entidade.alterada e entidade.apagada escutam:');
        entities.forEach((entity: EntityDef) => {
            printLine(context, `  ${entity.entity.padEnd(32)} ${entity.label} (${String(entity.fields.length)} campos)`);
        });
    }
    if (limits?.updateWindowHours !== undefined) {
        printLine(context, `Janela de alterações: ${String(limits.updateWindowHours)} h por registro (veja \`nexo automations runs\`).`);
    }
    printNotice(
        context,
        'Os campos que uma condição compara e os limites estão em `nexo automations catalog --json`; os campos de cada entidade, em `nexo automations entities`.'
    );
}

export async function automationsList(context: CliContext, options: AutomationOptions): Promise<void> {
    const body: { flows: FlowRow[] } = (await call(context, sessionOf(context, options), 'GET', '')) as { flows: FlowRow[] };
    if (options.json === true) {
        printJson(context, body);
        return;
    }
    body.flows.forEach((flow: FlowRow) => {
        printLine(
            context,
            `${flow.id}  ${flow.state.padEnd(15)} v${flow.publishedSeq === null ? '-' : String(flow.publishedSeq)}  ${flow.name}`
        );
    });
}

export async function automationsGet(
    context: CliContext,
    id: string | undefined,
    dir: string | undefined,
    options: AutomationOptions
): Promise<void> {
    const flowId: string = id ?? flowIdOf(options, dir);
    const detail: FlowDetail = (await call(context, sessionOf(context, options), 'GET', `/${flowId}`)) as FlowDetail;
    if (options.json === true) {
        printJson(context, detail);
        return;
    }
    const { flow, working } = detail;
    printLine(
        context,
        `${flow.id}  ${flow.state}  ${flow.publishedSeq === null ? 'sem versão no ar' : `v${String(flow.publishedSeq)} no ar`}  ${flow.name}`
    );
    if (working === null) {
        return;
    }
    describeDocument(working.document).forEach((line: string) => {
        printLine(context, line);
    });
    if (working.problems.length > 0) {
        printLine(context, `${String(working.problems.length)} problema(s) no rascunho:`);
        describeProblems(working.problems).forEach((line: string) => {
            printLine(context, line);
        });
    }
}

function entityQuery(options: AutomationOptions): string {
    return options.domain === undefined ? '' : `?domain=${encodeURIComponent(options.domain)}`;
}

function printEntity(context: CliContext, entity: EntityDef): void {
    printLine(context, `${entity.entity}  ${entity.label} (${entity.plural}) — vê: ${entity.sees}`);
    entity.fields.forEach((field) => {
        printLine(context, `  ${field.key.padEnd(28)} ${field.type.padEnd(12)} ${field.label}`);
    });
}

export async function automationsEntities(context: CliContext, entity: string | undefined, options: AutomationOptions): Promise<void> {
    const path: string =
        entity === undefined ? `/entities${entityQuery(options)}` : `/entities/${encodeURIComponent(entity)}${entityQuery(options)}`;
    const body: unknown = await call(context, sessionOf(context, options), 'GET', path);
    if (options.json === true) {
        printJson(context, body);
        return;
    }
    const entities: readonly EntityDef[] = entity === undefined ? (body as { entities: EntityDef[] }).entities : [body as EntityDef];
    entities.forEach((item: EntityDef) => {
        printEntity(context, item);
    });
}

export async function automationsEvents(context: CliContext, entity: string, subjectId: string, options: AutomationOptions): Promise<void> {
    const params: URLSearchParams = new URLSearchParams({ entity, subjectId });
    if (options.domain !== undefined) {
        params.set('domain', options.domain);
    }
    if (options.limit !== undefined) {
        params.set('limit', options.limit);
    }
    if (options.cursor !== undefined) {
        params.set('cursor', options.cursor);
    }
    const page: EventPage = (await call(context, sessionOf(context, options), 'GET', `/events?${params.toString()}`)) as EventPage;
    if (options.json === true) {
        printJson(context, page);
        return;
    }
    if (page.events.length === 0) {
        printLine(context, `Nenhum evento deste registro nos últimos ${String(page.retentionDays)} dias.`);
        return;
    }
    page.events.forEach((event: EntityEvent) => {
        const fields: string = event.changedFields.length === 0 ? '' : `  campos: ${event.changedFields.join(', ')}`;
        const origin: string = event.origin.flowId === null ? (event.origin.surface ?? '?') : `automação ${event.origin.flowId}`;
        const dispatch: string =
            event.failureCode === null ? (event.dispatched ? 'despachado' : 'pendente') : `desistiu (${event.failureCode})`;
        printLine(context, `${event.occurredAt}  ${event.operation.padEnd(8)} por ${event.actorKind} via ${origin}  ${dispatch}${fields}`);
    });
    if (page.hasMore && page.nextCursor !== null) {
        printNotice(context, `Há eventos mais antigos: --cursor ${page.nextCursor}`);
    }
}

export async function automationsVersions(context: CliContext, dir: string | undefined, options: AutomationOptions): Promise<void> {
    const body: { versions: VersionRow[] } = (await call(
        context,
        sessionOf(context, options),
        'GET',
        `/${flowIdOf(options, dir)}/versions`
    )) as {
        versions: VersionRow[];
    };
    if (options.json === true) {
        printJson(context, body);
        return;
    }
    body.versions.forEach((version: VersionRow) => {
        const label: string = version.seq === null ? 'rascunho' : `v${String(version.seq)}`;
        const restored: string = version.restoredFromSeq === null ? '' : ` (volta da v${String(version.restoredFromSeq)})`;
        printLine(
            context,
            `${label.padEnd(9)} ${version.status.padEnd(10)} ${version.origin.padEnd(5)} ${version.createdAt}${restored}  ${version.summary ?? ''}`.trimEnd()
        );
    });
}

export async function automationsRestore(
    context: CliContext,
    seq: string,
    dir: string | undefined,
    options: AutomationOptions
): Promise<void> {
    if (!/^\d+$/.test(seq)) {
        throw usageError('A versão é o número, como em `nexo automations versions`.');
    }
    const flowId: string = flowIdOf(options, dir);
    const session: Session = sessionOf(context, options);
    printLine(context, `Voltar à versão ${seq}: cria uma versão nova com o documento antigo e ela passa a rodar na empresa.`);
    if (!(await confirmed(context, options))) {
        return;
    }
    const restored: unknown = await call(context, session, 'POST', `/${flowId}/versions/${seq}/restore`, {
        ...(options.cancelLiveRuns === true ? { cancelLiveRuns: true } : {})
    });
    if (options.json === true) {
        printJson(context, restored);
        return;
    }
    printLine(context, `Versão ${seq} restaurada como versão nova.`);
}

export function automationsInit(context: CliContext, dir: string, options: AutomationOptions): void {
    const directory: string = projectDirectory(dir);
    ensureEmpty(directory);
    writeAutomation(directory, templateAutomation(options.name ?? 'Nova automação'));
    writeAutomationState(directory, { flowId: null });
    printLine(context, `Automação criada em ${directory}.`);
    printNotice(
        context,
        'Troque KIND_DO_GATILHO e KIND_DA_ACAO pelos do `nexo automations catalog`, e suba com `nexo automations push -m "o que mudou"`.'
    );
}

function reportWorking(context: CliContext, working: WorkingVersion): void {
    if (working.problems.length === 0) {
        printLine(context, 'Rascunho salvo, sem problemas. Publique com `nexo automations publish`.');
        return;
    }
    printLine(context, `Rascunho salvo com ${String(working.problems.length)} problema(s), que impedem a publicação:`);
    describeProblems(working.problems).forEach((line: string) => {
        printLine(context, line);
    });
}

export async function automationsPush(context: CliContext, dir: string | undefined, options: AutomationOptions): Promise<void> {
    const directory: string = projectDirectory(dir);
    const settings: AutomationSettings = readAutomation(directory);
    const state: AutomationState = readAutomationState(directory);
    const summary: string | undefined = options.summary?.trim() === '' ? undefined : options.summary;
    const session: Session = sessionOf(context, options);
    const saved: { flow: FlowRow; version: WorkingVersion } = (
        state.flowId === null
            ? await call(context, session, 'POST', '', { ...settings, ...(summary === undefined ? {} : { summary }) })
            : await call(context, session, 'PUT', `/${state.flowId}/draft`, {
                  document: settings.document,
                  ...(summary === undefined ? {} : { summary })
              })
    ) as { flow: FlowRow; version: WorkingVersion };
    writeAutomationState(directory, { flowId: saved.flow.id });
    if (options.json === true) {
        printJson(context, saved);
        return;
    }
    reportWorking(context, saved.version);
}

export async function automationsPull(
    context: CliContext,
    flowId: string,
    dir: string | undefined,
    options: AutomationOptions
): Promise<void> {
    const directory: string = projectDirectory(dir ?? flowId);
    ensureEmpty(directory);
    const detail: FlowDetail = (await call(context, sessionOf(context, options), 'GET', `/${flowId}`)) as FlowDetail;
    if (detail.working === null) {
        throw new CliError('Essa automação não tem versão salva.', EXIT_CODES.notFound);
    }
    const { name, description, reentryMode, reentryMinutes, reactsToAutomations } = detail.flow;
    writeAutomation(directory, { name, description, reentryMode, reentryMinutes, reactsToAutomations, document: detail.working.document });
    writeAutomationState(directory, { flowId });
    printLine(context, `"${name}" em ${directory}.`);
}

async function confirmed(context: CliContext, options: AutomationOptions): Promise<boolean> {
    if (options.yes === true) {
        return true;
    }
    if (context.stdin.isTTY !== true) {
        printNotice(context, 'Mostre isto à pessoa. Depois do sim dela, rode de novo com --yes.');
        return false;
    }
    const reader: Interface = createInterface({ input: context.stdin, output: context.stderr, terminal: true });
    try {
        const answer: string = await new Promise<string>((resolve: (text: string) => void) => {
            reader.question('Continuar? (s/N) ', resolve);
        });
        return /^(s|sim|y|yes)$/i.test(answer.trim());
    } finally {
        reader.close();
    }
}

function showDiff(context: CliContext, live: Record<string, unknown>, draft: Record<string, unknown>): void {
    const lines: readonly string[] = describeDiff(live, draft);
    printLine(
        context,
        lines.length === 0 ? 'O rascunho é igual à versão no ar.' : 'O que muda em relação à versão no ar (+ entra, - sai, ~ muda):'
    );
    lines.forEach((line: string) => {
        printLine(context, line);
    });
}

async function liveDocument(
    context: CliContext,
    session: Session,
    flowId: string,
    seq: number | null
): Promise<Record<string, unknown> | null> {
    if (seq === null) {
        return null;
    }
    return ((await call(context, session, 'GET', `/${flowId}/versions/${String(seq)}`)) as { document: Record<string, unknown> }).document;
}

function showContent(context: CliContext, live: Record<string, unknown> | null, draft: Record<string, unknown>): void {
    if (live !== null) {
        showDiff(context, live, draft);
        return;
    }
    describeDocument(draft).forEach((line: string) => {
        printLine(context, line);
    });
}

function listensToUpdates(document: Record<string, unknown>): boolean {
    const nodes: unknown = document.nodes;
    return Array.isArray(nodes) && nodes.some((node: unknown) => (node as { kind?: unknown }).kind === 'entidade.alterada');
}

function showPublishPreview(
    context: CliContext,
    detail: FlowDetail,
    local: AutomationSettings | null,
    live: Record<string, unknown> | null
): void {
    const headline: string =
        detail.flow.publishedSeq === null
            ? 'Primeira publicação: a automação liga.'
            : `Substitui a versão ${String(detail.flow.publishedSeq)}, que está no ar.`;
    printLine(context, `Publicar "${detail.flow.name}". ${headline}`);
    showContent(context, live, detail.working?.document ?? {});
    if (listensToUpdates(detail.working?.document ?? {})) {
        printLine(
            context,
            `Janela de ${String(UPDATE_WINDOW_HOURS)} h: depois de uma alteração, as seguintes do mesmo registro, dentro de ${String(UPDATE_WINDOW_HOURS)} h, não disparam a regra de novo.`
        );
    }
    if (local !== null && !sameDocument(local.document, detail.working?.document)) {
        printNotice(
            context,
            'Atenção: o automation.json desta pasta é diferente do rascunho no Nexo. Rode `nexo automations push` antes, se quer publicar o da pasta.'
        );
    }
}

export async function automationsPublish(context: CliContext, dir: string | undefined, options: AutomationOptions): Promise<void> {
    const flowId: string = flowIdOf(options, dir);
    const session: Session = sessionOf(context, options);
    const detail: FlowDetail = (await call(context, session, 'GET', `/${flowId}`)) as FlowDetail;
    if (detail.working === null || detail.working.problems.length > 0) {
        describeProblems(detail.working?.problems ?? []).forEach((line: string) => {
            printLine(context, line);
        });
        throw new CliError(
            'O rascunho tem problemas e não pode ser publicado.',
            EXIT_CODES.failure,
            'Corrija, `nexo automations push` e tente de novo.'
        );
    }
    const local: AutomationSettings | null = options.automation === undefined ? readAutomation(projectDirectory(dir)) : null;
    showPublishPreview(context, detail, local, await liveDocument(context, session, flowId, detail.flow.publishedSeq));
    if (!(await confirmed(context, options))) {
        return;
    }
    const published: unknown = await call(context, session, 'POST', `/${flowId}/publish`, {
        versionId: detail.working.id,
        ...(options.cancelLiveRuns === true ? { cancelLiveRuns: true } : {})
    });
    if (options.json === true) {
        printJson(context, published);
        return;
    }
    printLine(context, 'Publicada.');
}

export async function automationsToggle(
    context: CliContext,
    action: 'pause' | 'resume',
    dir: string | undefined,
    options: AutomationOptions
): Promise<void> {
    const body: unknown = await call(context, sessionOf(context, options), 'POST', `/${flowIdOf(options, dir)}/${action}`);
    if (options.json === true) {
        printJson(context, body);
        return;
    }
    printLine(context, action === 'pause' ? 'Pausada. O que acontecer na pausa não roda depois.' : 'Ligada de novo.');
}

interface RunRow {
    readonly id: string;
    readonly state: string;
    readonly stateReason: string | null;
    readonly errorCode: string | null;
    readonly subject: { readonly type: string; readonly name: string | null };
    readonly createdAt: string;
    readonly suppressedUpdates?: number;
    readonly updateWindowEndsAt?: string | null;
}

function runNote(run: RunRow): string {
    const reason: string = run.errorCode ?? run.stateReason ?? '';
    if (run.updateWindowEndsAt === undefined || run.updateWindowEndsAt === null) {
        return reason;
    }
    const window: string = `janela até ${run.updateWindowEndsAt} (${String(run.suppressedUpdates ?? 0)} repetidas descartadas)`;
    return reason === '' ? window : `${reason}  ${window}`;
}

export async function automationsRuns(context: CliContext, dir: string | undefined, options: AutomationOptions): Promise<void> {
    const query: string = options.state === undefined ? '' : `?state=${encodeURIComponent(options.state)}`;
    const body: { runs: RunRow[] } = (await call(
        context,
        sessionOf(context, options),
        'GET',
        `/${flowIdOf(options, dir)}/runs${query}`
    )) as { runs: RunRow[] };
    if (options.json === true) {
        printJson(context, body);
        return;
    }
    body.runs.forEach((run: RunRow) => {
        const why: string = runNote(run);
        printLine(
            context,
            `${run.id}  ${run.state.padEnd(9)} ${run.createdAt}  ${run.subject.type} ${run.subject.name ?? '(apagado)'}  ${why}`.trimEnd()
        );
    });
}

export async function automationsRun(context: CliContext, runId: string, options: AutomationOptions): Promise<void> {
    const body: { run: RunRow; steps?: { label?: string; state: string; errorCode: string | null; summary?: string | null }[] } =
        (await call(context, sessionOf(context, options), 'GET', `/runs/${runId}`)) as {
            run: RunRow;
            steps?: { label?: string; state: string; errorCode: string | null; summary?: string | null }[];
        };
    if (options.json === true) {
        printJson(context, body);
        return;
    }
    printLine(context, `Execução ${body.run.id}: ${body.run.state}${body.run.errorCode === null ? '' : ` (${body.run.errorCode})`}`);
    (body.steps ?? []).forEach((step) => {
        printLine(
            context,
            `  ${step.label ?? '?'}: ${step.state}${step.errorCode === null ? '' : ` [${step.errorCode}]`} ${step.summary ?? ''}`.trimEnd()
        );
    });
}
