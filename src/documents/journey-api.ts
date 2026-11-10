import { clientOf, printNotice } from '../context.js';
import type { CliContext } from '../context.js';
import type { Session } from '../config/session.js';
import { CliError, usageError } from '../errors.js';
import { EXIT_CODES } from '../exit-codes.types.js';
import type { ApiResponse, HttpMethod } from '../http/nexo-client.js';
import type { DocumentAgent, DocumentView, VersionStatus, VersionSummary } from './journey.types.js';

const BASE: string = '/v1/agents';
const POLL_MS: number = 4000;

export const DEFAULT_TIMEOUT_SECONDS: string = '900';

const STATUS_LABELS: Readonly<Record<VersionStatus, string>> = {
    draft: 'rascunho',
    queued: 'na fila',
    running: 'o Nexo está escrevendo',
    ready: 'pronta',
    failed: 'não saiu'
};

const FAILURE_LABELS: Readonly<Record<string, string>> = {
    ai_unavailable: 'a IA não respondeu; peça de novo',
    ai_rejected: 'a IA recusou o pedido ou a resposta foi cortada',
    budget: 'o limite de IA do ciclo da empresa acabou e nada foi escrito',
    ai_budget: 'o limite de IA do ciclo da empresa acabou e nada foi escrito',
    values_mismatch: 'a conferência achou valor, data ou prazo que não bate com as respostas',
    check_failed: 'o documento não passou na conferência',
    too_long: 'o contrato passa do tamanho que o Nexo escreve de uma vez'
};

export async function call(context: CliContext, session: Session, method: HttpMethod, path: string, body?: unknown): Promise<unknown> {
    const response: ApiResponse = await clientOf(context, session).request({
        method,
        path: `${BASE}${path}`,
        ...(body === undefined ? {} : { body })
    });
    return response.body;
}

export function agentOf(value: string | null | undefined): DocumentAgent {
    if (value !== 'proposal' && value !== 'contract') {
        throw usageError('Diga o agente com --agent proposal ou --agent contract.');
    }
    return value;
}

export async function documentOf(context: CliContext, session: Session, documentId: string): Promise<DocumentView> {
    return (await call(context, session, 'GET', `/documents/${encodeURIComponent(documentId)}`)) as DocumentView;
}

export function versionOf(document: DocumentView, raw: string | undefined): VersionSummary {
    if (raw !== undefined && !/^\d+$/.test(raw)) {
        throw usageError('A versão é o número, como em `nexo documents get`.');
    }
    const version: VersionSummary | null | undefined =
        raw === undefined ? document.current : document.versions.find((each: VersionSummary) => each.version === Number(raw));
    if (version === null || version === undefined) {
        throw new CliError(
            raw === undefined ? 'Este documento ainda não tem versão.' : `Este documento não tem a versão ${raw}.`,
            EXIT_CODES.notFound
        );
    }
    return version;
}

export function statusLabel(status: VersionStatus): string {
    return STATUS_LABELS[status];
}

export function failureOf(version: VersionSummary): readonly string[] {
    const reason: string = FAILURE_LABELS[version.failureReason ?? ''] ?? 'erro inesperado; peça de novo';
    return [
        `A versão ${String(version.version)} não saiu: ${reason}.`,
        ...[...version.valueFindings, ...version.checkFindings].map(bullet)
    ];
}

function bullet(text: string): string {
    return `  - ${text}`;
}

export function timeoutOf(raw: string | undefined): number {
    const text: string = raw ?? DEFAULT_TIMEOUT_SECONDS;
    if (!/^\d+$/.test(text)) {
        throw usageError('--timeout é em segundos, um número inteiro.');
    }
    return Number(text) * 1000;
}

export async function pause(context: CliContext, ms: number): Promise<void> {
    if (context.sleep !== undefined) {
        await context.sleep(ms);
        return;
    }
    await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, ms);
    });
}

async function versionNow(context: CliContext, session: Session, documentId: string, versionId: string): Promise<VersionSummary> {
    const document: DocumentView = await documentOf(context, session, documentId);
    const version: VersionSummary | undefined = document.versions.find((each: VersionSummary) => each.id === versionId);
    if (version === undefined) {
        throw new CliError('A versão pedida não está mais no documento.', EXIT_CODES.notFound);
    }
    return version;
}

export interface Polling<T> {
    readonly read: () => Promise<T>;
    readonly stateOf: (value: T) => string;
    readonly describe: (value: T) => string;
    readonly settled: (value: T) => boolean;
    readonly timeoutMs: number;
    readonly late: CliError;
}

export async function poll<T>(context: CliContext, polling: Polling<T>): Promise<T> {
    let seen: string = '';
    for (let waited: number = 0; waited <= polling.timeoutMs; waited += POLL_MS) {
        const value: T = await polling.read();
        if (polling.stateOf(value) !== seen) {
            seen = polling.stateOf(value);
            printNotice(context, polling.describe(value));
        }
        if (polling.settled(value)) {
            return value;
        }
        await pause(context, POLL_MS);
    }
    throw polling.late;
}

export async function waitForVersion(
    context: CliContext,
    session: Session,
    ids: { readonly documentId: string; readonly versionId: string },
    timeoutMs: number
): Promise<VersionSummary> {
    return poll(context, {
        read: () => versionNow(context, session, ids.documentId, ids.versionId),
        stateOf: (version: VersionSummary) => version.status,
        describe: (version: VersionSummary) => `Versão ${String(version.version)}: ${statusLabel(version.status)}.`,
        settled: (version: VersionSummary) => version.status === 'ready' || version.status === 'failed',
        timeoutMs,
        late: new CliError(
            'A versão ainda não ficou pronta.',
            EXIT_CODES.failure,
            `Ela continua sendo escrita. Acompanhe com \`nexo documents get ${ids.documentId}\`.`
        )
    });
}
