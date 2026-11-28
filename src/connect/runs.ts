import { clientOf, printLine } from '../context.js';
import type { CliContext } from '../context.js';
import type { Session } from '../config/session.js';
import { CliError } from '../errors.js';
import { EXIT_CODES } from '../exit-codes.types.js';
import type { ApiResponse } from '../http/nexo-client.js';

export interface PlannedCall {
    /** O passo do Nexo (`ctx.nexo.create`) não traz método nem operação. */
    readonly method?: string | null;
    readonly host: string;
    readonly path: string;
    readonly operation?: string | null;
    readonly count: number;
}

export interface RunStep {
    readonly at?: string | null;
    readonly kind: string;
    readonly target: string | null;
    readonly status: number | null;
    readonly errorCode: string | null;
    readonly message: string | null;
    /** O `data` de um log do script (`ctx.log`). */
    readonly data?: unknown;
}

export interface PlannedQuarantineItem {
    readonly object: string;
    readonly externalId: string | null;
    readonly code: string;
    readonly reason: string;
    readonly values: Record<string, unknown>;
    readonly properties?: Record<string, unknown>;
}

/** Uma resposta antiga não traz `output` nem `plannedQuarantine`: os dois são opcionais. */
export interface PlannedQuarantine {
    readonly total: number;
    readonly items: readonly PlannedQuarantineItem[];
}

export interface Run {
    readonly id: string;
    readonly status: 'running' | 'succeeded' | 'partial' | 'failed' | 'timed_out';
    readonly mode: string;
    readonly failureReason: string | null;
    readonly counters: Record<string, unknown> | null;
    readonly plannedNexoWrites: readonly PlannedCall[] | null;
    readonly plannedWrites: readonly PlannedCall[] | null;
    readonly steps: readonly RunStep[] | null;
    readonly error: { readonly name: string | null; readonly message: string | null; readonly stack: string | null } | null;
    readonly output?: Record<string, unknown> | null;
    readonly plannedQuarantine?: PlannedQuarantine | null;
}

/** O que se corta na tela; o `--json` traz tudo. */
export const MAX_OUTPUT_LINES: number = 20;
export const MAX_QUARANTINE_ITEMS: number = 10;

export interface WaitOptions {
    readonly intervalMs: number;
    readonly timeoutMs: number;
}

export const DEFAULT_WAIT: WaitOptions = { intervalMs: 2000, timeoutMs: 10 * 60_000 };

function isRun(value: unknown): value is Run {
    return typeof value === 'object' && value !== null && typeof (value as { status?: unknown }).status === 'string';
}

export async function fetchRun(context: CliContext, session: Session, connectorId: string, runId: string): Promise<Run> {
    const response: ApiResponse = await clientOf(context, session).request({
        method: 'GET',
        path: `/v1/connect/connectors/${connectorId}/runs/${runId}`
    });
    if (!isRun(response.body)) {
        throw new Error('Execução em formato inesperado.');
    }
    return response.body;
}

function pause(milliseconds: number): Promise<void> {
    return new Promise<void>((resolve: () => void) => setTimeout(resolve, milliseconds));
}

export async function waitForRun(
    context: CliContext,
    session: Session,
    ids: { connectorId: string; runId: string },
    wait: WaitOptions
): Promise<Run> {
    const deadline: number = Date.now() + wait.timeoutMs;
    let run: Run = await fetchRun(context, session, ids.connectorId, ids.runId);
    while (run.status === 'running') {
        if (Date.now() > deadline) {
            throw new CliError('A execução ainda está rodando.', EXIT_CODES.failure, `Acompanhe com \`nexo connect run ${ids.runId}\`.`);
        }
        await pause(wait.intervalMs);
        run = await fetchRun(context, session, ids.connectorId, ids.runId);
    }
    return run;
}

function plannedLines(title: string, calls: readonly PlannedCall[] | null): readonly string[] {
    if (calls === null || calls.length === 0) {
        return [];
    }
    return [title, ...calls.map((call: PlannedCall) => `  ${plannedCall(call)} × ${String(call.count)}`)];
}

function plannedCall(call: PlannedCall): string {
    const path: string = call.path === '' || call.path.startsWith('/') ? call.path : `/${call.path}`;
    const parts: readonly string[] = [
        ...(call.method === undefined || call.method === null || call.method === '' ? [] : [call.method]),
        `${call.host}${path}`,
        ...(call.operation === undefined || call.operation === null || call.operation === '' ? [] : [`(${call.operation})`])
    ];
    return parts.join(' ');
}

function failedSteps(steps: readonly RunStep[] | null): readonly string[] {
    const failed: readonly RunStep[] = (steps ?? []).filter(
        (step: RunStep) => (step.errorCode ?? null) !== null || (step.status ?? 0) >= 400
    );
    return failed
        .slice(0, 10)
        .map((step: RunStep) =>
            `  ${step.kind} ${step.target ?? ''} → ${step.errorCode ?? String(step.status)}: ${step.message ?? ''}`.trimEnd()
        );
}

export function cut(lines: readonly string[], max: number, what: string): readonly string[] {
    return lines.length <= max ? lines : [...lines.slice(0, max), `  … mais ${String(lines.length - max)} ${what} (veja com --json)`];
}

function compact(value: unknown): string {
    return JSON.stringify(value);
}

function timeOf(at: string | null | undefined): string {
    return at === undefined || at === null ? '' : `${at.slice(11, 19)} `;
}

function logLines(steps: readonly RunStep[] | null): readonly string[] {
    const logs: readonly RunStep[] = (steps ?? []).filter((step: RunStep) => step.kind === 'log');
    if (logs.length === 0) {
        return [];
    }
    const lines: readonly string[] = logs.map((log: RunStep) =>
        `  ${timeOf(log.at)}${log.message ?? ''}${log.data === undefined || log.data === null ? '' : ` ${compact(log.data)}`}`.trimEnd()
    );
    return ['Logs do script:', ...cut(lines, MAX_OUTPUT_LINES, 'logs')];
}

function outputLines(output: Run['output']): readonly string[] {
    if (output === undefined || output === null || Object.keys(output).length === 0) {
        return [];
    }
    const lines: readonly string[] = JSON.stringify(output, null, 2)
        .split('\n')
        .map((line: string) => `  ${line}`);
    return ['Resultado da operação:', ...cut(lines, MAX_OUTPUT_LINES, 'linhas')];
}

function quarantineLines(planned: Run['plannedQuarantine']): readonly string[] {
    if (planned === undefined || planned === null || (planned.total === 0 && planned.items.length === 0)) {
        return [];
    }
    const shown: readonly PlannedQuarantineItem[] = planned.items.slice(0, MAX_QUARANTINE_ITEMS);
    const lines: readonly string[] = shown.map(
        (item: PlannedQuarantineItem) =>
            `  ${item.object} ${item.externalId ?? '-'}: ${item.reason} (${item.code}) ${compact({ ...item.values, ...(item.properties === undefined ? {} : { properties: item.properties }) })}`
    );
    const total: number = Math.max(planned.total, planned.items.length);
    return [
        `Iriam para a quarentena (${String(total)}):`,
        ...lines,
        ...(total > shown.length ? [`  … mais ${String(total - shown.length)} (veja com --json)`] : [])
    ];
}

function headLines(run: Run): readonly string[] {
    const lines: string[] = [`Execução ${run.id}: ${run.status}${run.mode === 'dry_run' ? ' (ensaio)' : ''}`];
    if (run.failureReason !== null) {
        lines.push(`Motivo: ${run.failureReason}`);
    }
    if (run.counters !== null && Object.keys(run.counters).length > 0) {
        lines.push(`Contadores: ${JSON.stringify(run.counters)}`);
    }
    return lines;
}

function errorLines(run: Run): readonly string[] {
    const failed: readonly string[] = failedSteps(run.steps);
    return [
        ...(failed.length > 0 ? ['Passos com erro:', ...failed] : []),
        ...(run.error === null
            ? []
            : [`Erro: ${run.error.name ?? 'Error'}: ${run.error.message ?? ''}`, ...(run.error.stack === null ? [] : [run.error.stack])])
    ];
}

export function describeRun(run: Run, options: { readonly quiet?: boolean } = {}): readonly string[] {
    const lines: string[] = [
        ...headLines(run),
        ...plannedLines('Escreveria no Nexo:', run.plannedNexoWrites),
        ...plannedLines('Escreveria no outro sistema:', run.plannedWrites),
        ...errorLines(run)
    ];
    if (options.quiet !== true) {
        lines.push(...logLines(run.steps), ...outputLines(run.output), ...quarantineLines(run.plannedQuarantine));
    }
    return lines;
}

export function printRun(context: CliContext, run: Run, options: { readonly quiet?: boolean } = {}): void {
    for (const line of describeRun(run, options)) {
        printLine(context, line);
    }
}

export function runIsClean(run: Run): boolean {
    return run.status === 'succeeded' && run.error === null;
}
