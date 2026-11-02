import { clientOf, printLine } from '../context.js';
import type { CliContext } from '../context.js';
import type { Session } from '../config/session.js';
import { CliError } from '../errors.js';
import { EXIT_CODES } from '../exit-codes.types.js';
import type { ApiResponse } from '../http/nexo-client.js';

export interface PlannedCall {
    readonly method: string;
    readonly host: string;
    readonly path: string;
    readonly operation: string;
    readonly count: number;
}

export interface RunStep {
    readonly kind: string;
    readonly target: string | null;
    readonly status: number | null;
    readonly errorCode: string | null;
    readonly message: string | null;
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
}

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
            throw new CliError('O ensaio ainda está rodando.', EXIT_CODES.failure, `Acompanhe com \`nexo connect run ${ids.runId}\`.`);
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
    return [
        title,
        ...calls.map((call: PlannedCall) => `  ${call.method} ${call.host}${call.path} (${call.operation}) × ${String(call.count)}`)
    ];
}

function failedSteps(steps: readonly RunStep[] | null): readonly string[] {
    const failed: readonly RunStep[] = (steps ?? []).filter((step: RunStep) => step.errorCode !== null || (step.status ?? 0) >= 400);
    return failed
        .slice(0, 10)
        .map((step: RunStep) =>
            `  ${step.kind} ${step.target ?? ''} → ${step.errorCode ?? String(step.status)}: ${step.message ?? ''}`.trimEnd()
        );
}

export function describeRun(run: Run): readonly string[] {
    const lines: string[] = [`Execução ${run.id}: ${run.status}${run.mode === 'dry_run' ? ' (ensaio)' : ''}`];
    if (run.failureReason !== null) {
        lines.push(`Motivo: ${run.failureReason}`);
    }
    if (run.counters !== null && Object.keys(run.counters).length > 0) {
        lines.push(`Contadores: ${JSON.stringify(run.counters)}`);
    }
    lines.push(
        ...plannedLines('Escreveria no Nexo:', run.plannedNexoWrites),
        ...plannedLines('Escreveria no outro sistema:', run.plannedWrites)
    );
    const failed: readonly string[] = failedSteps(run.steps);
    if (failed.length > 0) {
        lines.push('Passos com erro:', ...failed);
    }
    if (run.error !== null) {
        lines.push(
            `Erro: ${run.error.name ?? 'Error'}: ${run.error.message ?? ''}`,
            ...(run.error.stack === null ? [] : [run.error.stack])
        );
    }
    return lines;
}

export function printRun(context: CliContext, run: Run): void {
    for (const line of describeRun(run)) {
        printLine(context, line);
    }
}

export function runIsClean(run: Run): boolean {
    return run.status === 'succeeded' && run.error === null;
}
