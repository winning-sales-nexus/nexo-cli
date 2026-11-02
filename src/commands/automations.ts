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
import { describeDocument, describeProblems, sameDocument } from '../automations/summary.js';
import type { FlowProblem } from '../automations/summary.js';

export interface AutomationOptions extends GlobalOptions {
    readonly automation?: string;
    readonly name?: string;
    readonly summary?: string;
    readonly yes?: boolean;
    readonly cancelLiveRuns?: boolean;
    readonly state?: string;
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

const BASE: string = '/v1/automations';

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
    const { triggers, actions } = catalog as {
        triggers: { kind: string; label: string; configHint?: string }[];
        actions: { kind: string; label: string; risk: string; configHint?: string }[];
    };
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
    printNotice(context, 'Os campos que uma condição compara e os limites estão em `nexo automations catalog --json`.');
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
            reader.question('Publicar? (s/N) ', resolve);
        });
        return /^(s|sim|y|yes)$/i.test(answer.trim());
    } finally {
        reader.close();
    }
}

function showPublishPreview(context: CliContext, detail: FlowDetail, local: AutomationSettings | null): void {
    const live: string =
        detail.flow.publishedSeq === null
            ? 'Primeira publicação: a automação liga.'
            : `Substitui a versão ${String(detail.flow.publishedSeq)}, que está no ar.`;
    printLine(context, `Publicar "${detail.flow.name}". ${live}`);
    describeDocument(detail.working?.document ?? {}).forEach((line: string) => {
        printLine(context, line);
    });
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
    showPublishPreview(context, detail, local);
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
        const why: string = run.errorCode ?? run.stateReason ?? '';
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
