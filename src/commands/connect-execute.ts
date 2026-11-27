import { clientOf, printLine, sessionOf } from '../context.js';
import type { CliContext } from '../context.js';
import type { Session } from '../config/session.js';
import { CliError } from '../errors.js';
import { EXIT_CODES } from '../exit-codes.types.js';
import type { ApiResponse } from '../http/nexo-client.js';
import { requestChange, requestLocalChange } from '../connect/changes.js';
import { DEFAULT_WAIT, printRun, runIsClean, waitForRun } from '../connect/runs.js';
import type { Run, WaitOptions } from '../connect/runs.js';
import { fetchConnector } from './connect-files.js';
import { connectorIdOf } from './connect-runs.js';
import type { ConnectRunOptions, Rehearsal } from './connect-runs.js';

export interface ExecuteOptions extends Omit<ConnectRunOptions, 'confirm'> {
    /** Em `run-now` e `initial-load` a confirmação é local (sem token); em `undo` é o token da prévia. */
    readonly confirm?: string | boolean;
}

type ExecutionKind = 'run-now' | 'initial-load';

const EXECUTIONS: Readonly<Record<ExecutionKind, { readonly path: string; readonly what: string }>> = {
    'run-now': { path: 'runs', what: 'roda agora, como o gatilho rodaria' },
    'initial-load': { path: 'initial-load', what: 'faz a carga inicial, lendo a origem inteira' }
};

function opened(body: unknown): Rehearsal {
    const fields: Partial<Rehearsal> = typeof body === 'object' && body !== null ? body : {};
    if (typeof fields.runId !== 'string') {
        throw new Error('Execução aberta em formato inesperado.');
    }
    return { runId: fields.runId, link: fields.link ?? '' };
}

interface Outcome {
    run: Run | null;
    link: string;
}

function executionPreview(kind: ExecutionKind, published: number | null): { title: string; changes: readonly string[] } {
    const version: string = published === null ? 'publicada' : `${String(published)} (a publicada)`;
    return {
        title: `A versão ${version} ${EXECUTIONS[kind].what}`,
        changes: [
            'Grava no Nexo de verdade: não é ensaio.',
            'Tudo o que ela gravar no Nexo vai num conjunto que o desfazer leva de volta (`nexo connect undo <execução>`).',
            'O que ela mandar ao outro sistema não se desfaz.'
        ]
    };
}

async function openAndWait(
    context: CliContext,
    session: Session,
    request: { connectorId: string; path: string; wait: WaitOptions; noWait: boolean },
    outcome: Outcome
): Promise<ApiResponse> {
    const response: ApiResponse = await clientOf(context, session).request({
        method: 'POST',
        path: `/v1/connect/connectors/${request.connectorId}/${request.path}`
    });
    const started: Rehearsal = opened(response.body);
    outcome.link = started.link;
    if (request.noWait) {
        return response;
    }
    outcome.run = await waitForRun(context, session, { connectorId: request.connectorId, runId: started.runId }, request.wait);
    return { status: response.status, body: outcome.run };
}

function reportOutcome(context: CliContext, outcome: Outcome, quiet: boolean, body: unknown): void {
    if (outcome.run === null) {
        printLine(context, `Execução ${opened(body).runId} começou: ${outcome.link}`);
        return;
    }
    printRun(context, outcome.run, { quiet });
    printLine(context, `Tela: ${outcome.link}`);
}

export async function connectExecute(
    context: CliContext,
    kind: ExecutionKind,
    dir: string | undefined,
    options: ExecuteOptions,
    wait: WaitOptions = DEFAULT_WAIT
): Promise<void> {
    const connectorId: string = connectorIdOf(options, dir);
    const session: Session = sessionOf(context, options);
    const published: number | null = (await fetchConnector(context, session, connectorId)).connector.publishedSeq;
    const outcome: Outcome = { run: null, link: '' };
    await requestLocalChange(context, {
        preview: executionPreview(kind, published),
        command: `nexo connect ${kind}`,
        confirmed: options.confirm === true,
        yes: options.yes === true,
        json: options.json === true,
        apply: () =>
            openAndWait(context, session, { connectorId, path: EXECUTIONS[kind].path, wait, noWait: options.wait === false }, outcome),
        report: (body: unknown) => {
            reportOutcome(context, outcome, options.quiet === true, body);
        }
    });
    if (outcome.run !== null && !runIsClean(outcome.run)) {
        throw new CliError(
            'A execução não terminou limpa.',
            EXIT_CODES.failure,
            'Leia o erro acima; `nexo connect undo` leva de volta o que ela gravou.'
        );
    }
}

function undoSummary(body: unknown): readonly string[] {
    const result: { records?: number; notice?: string | null } = typeof body === 'object' && body !== null ? body : {};
    return [`Registros desfeitos: ${String(result.records ?? 0)}.`, ...(typeof result.notice === 'string' ? [result.notice] : [])];
}

export async function connectUndo(context: CliContext, runId: string, dir: string | undefined, options: ExecuteOptions): Promise<void> {
    await requestChange(context, sessionOf(context, options), {
        connectorId: connectorIdOf(options, dir),
        path: `runs/${encodeURIComponent(runId)}/undo`,
        command: `nexo connect undo ${runId}`,
        summarize: undoSummary,
        confirm: typeof options.confirm === 'string' ? options.confirm : undefined,
        yes: options.yes === true,
        json: options.json === true
    });
}
