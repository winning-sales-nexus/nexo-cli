import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { clientOf, printJson, printLine, printNotice, sessionOf } from '../context.js';
import type { CliContext } from '../context.js';
import type { Session } from '../config/session.js';
import { CliError } from '../errors.js';
import { EXIT_CODES } from '../exit-codes.types.js';
import type { ApiResponse } from '../http/nexo-client.js';
import { STATE_FILE, projectDirectory, readState } from '../connect/project.js';
import type { ConnectorState } from '../connect/project.js';
import { connectorIdOf } from './connect-runs.js';
import type { ConnectRunOptions } from './connect-runs.js';

export interface BuildOptions extends ConnectRunOptions {
    readonly message?: string;
}

export interface BuildWait {
    readonly intervalMs: number;
    readonly timeoutMs: number;
}

export const BUILD_WAIT: BuildWait = { intervalMs: 3000, timeoutMs: 10 * 60_000 };

const ALLOWANCE_NOTICE: string = 'Atenção: a conversa com a IA do Connect gasta a franquia de IA da empresa.';

interface Started {
    readonly connectorId: string;
    readonly turnId: string;
}

interface BuildMessage {
    readonly author: 'person' | 'assistant';
    readonly kind: string;
    readonly content: Record<string, unknown>;
    readonly at?: string;
}

interface Conversation {
    readonly messages: readonly BuildMessage[];
    readonly answering: boolean;
}

const KIND_LABELS: Readonly<Record<string, string>> = {
    access_request: 'pediu acesso',
    authorization_request: 'pediu a autorização do Nexo no sistema',
    host_request: 'pediu a aprovação de um host',
    rehearsal: 'ensaiou o conector',
    source: 'leu uma fonte'
};

function startedOf(body: unknown): Started {
    const fields: Partial<Started> = typeof body === 'object' && body !== null ? body : {};
    if (typeof fields.connectorId !== 'string' || typeof fields.turnId !== 'string') {
        throw new Error('Resposta da conversa em formato inesperado.');
    }
    return { connectorId: fields.connectorId, turnId: fields.turnId };
}

function conversationOf(body: unknown): Conversation {
    const fields: Partial<Conversation> = typeof body === 'object' && body !== null ? body : {};
    if (!Array.isArray(fields.messages) || typeof fields.answering !== 'boolean') {
        throw new Error('Conversa em formato inesperado.');
    }
    return { messages: fields.messages, answering: fields.answering };
}

async function fetchConversation(context: CliContext, session: Session, connectorId: string): Promise<Conversation> {
    const response: ApiResponse = await clientOf(context, session).request({
        method: 'GET',
        path: `/v1/connect/connectors/${connectorId}/build`
    });
    return conversationOf(response.body);
}

function pause(milliseconds: number): Promise<void> {
    return new Promise<void>((resolve: () => void) => setTimeout(resolve, milliseconds));
}

async function waitForAnswer(context: CliContext, session: Session, connectorId: string, wait: BuildWait): Promise<Conversation> {
    const deadline: number = Date.now() + wait.timeoutMs;
    let conversation: Conversation = await fetchConversation(context, session, connectorId);
    while (conversation.answering) {
        if (Date.now() > deadline) {
            throw new CliError('A IA ainda está respondendo.', EXIT_CODES.failure, 'Acompanhe com `nexo connect build show`.');
        }
        await pause(wait.intervalMs);
        conversation = await fetchConversation(context, session, connectorId);
    }
    return conversation;
}

function describeMessage(message: BuildMessage): readonly string[] {
    const who: string = message.author === 'person' ? 'Você' : 'IA';
    if (message.kind === 'text') {
        const text: unknown = message.content['text'];
        return [`${who}: ${typeof text === 'string' ? text : ''}`];
    }
    if (message.kind === 'version') {
        const summary: unknown = message.content['summary'];
        const seq: unknown = message.content['seq'];
        const head: string = `IA: escreveu a versão ${typeof seq === 'number' ? String(seq) : '?'}`;
        return [typeof summary === 'string' && summary !== '' ? `${head}: ${summary}` : head];
    }
    return [`${who}: ${KIND_LABELS[message.kind] ?? message.kind}`];
}

/** O que a IA fez na última vez: tudo depois da última fala da pessoa. */
function lastTurn(messages: readonly BuildMessage[]): readonly BuildMessage[] {
    let from: number = 0;
    messages.forEach((message: BuildMessage, index: number) => {
        if (message.author === 'person' && message.kind === 'text') {
            from = index;
        }
    });
    return messages.slice(from);
}

function writtenVersions(messages: readonly BuildMessage[]): number {
    return messages.filter((message: BuildMessage) => message.kind === 'version').length;
}

function printMessages(context: CliContext, messages: readonly BuildMessage[]): void {
    for (const line of messages.flatMap(describeMessage)) {
        printLine(context, line);
    }
}

function printTurn(context: CliContext, connectorId: string, dir: string | undefined, messages: readonly BuildMessage[]): void {
    const turn: readonly BuildMessage[] = lastTurn(messages);
    printMessages(context, turn);
    if (writtenVersions(turn) > 0) {
        printLine(context, `Para ver o código: nexo connect pull ${connectorId} ${dir ?? '<pasta>'}`);
    }
}

async function openTurn(
    context: CliContext,
    session: Session,
    request: { readonly path: string; readonly body: Record<string, unknown> }
): Promise<Started> {
    printNotice(context, ALLOWANCE_NOTICE);
    const response: ApiResponse = await clientOf(context, session).request({ method: 'POST', path: request.path, body: request.body });
    return startedOf(response.body);
}

async function followTurn(
    context: CliContext,
    session: Session,
    started: Started,
    dir: string | undefined,
    options: BuildOptions,
    wait: BuildWait
): Promise<void> {
    if (options.wait === false) {
        if (options.json === true) {
            printJson(context, started);
            return;
        }
        printLine(context, `Conector ${started.connectorId}, vez ${started.turnId}. Acompanhe com \`nexo connect build show\`.`);
        return;
    }
    if (options.json !== true) {
        printLine(context, `Conector ${started.connectorId}, vez ${started.turnId}. Esperando a IA responder...`);
    }
    const conversation: Conversation = await waitForAnswer(context, session, started.connectorId, wait);
    if (options.json === true) {
        printJson(context, { ...started, ...conversation });
        return;
    }
    printTurn(context, started.connectorId, dir, conversation.messages);
}

function existingConnector(options: BuildOptions, dir: string | undefined): string | null {
    if (options.connector !== undefined) {
        return options.connector;
    }
    const folder: string = projectDirectory(dir);
    if (!existsSync(join(folder, STATE_FILE))) {
        return null;
    }
    return readState(folder).connectorId;
}

function startBody(message: string, dir: string | undefined): Record<string, unknown> {
    const folder: string = projectDirectory(dir);
    if (!existsSync(join(folder, STATE_FILE))) {
        return { message };
    }
    const state: ConnectorState = readState(folder);
    return { message, name: state.name, ...(state.systemId === null ? {} : { systemId: state.systemId }) };
}

export async function connectBuild(
    context: CliContext,
    message: string,
    dir: string | undefined,
    options: BuildOptions,
    wait: BuildWait = BUILD_WAIT
): Promise<void> {
    const session: Session = sessionOf(context, options);
    const connectorId: string | null = existingConnector(options, dir);
    const started: Started =
        connectorId === null
            ? await openTurn(context, session, { path: '/v1/connect/build', body: startBody(message, dir) })
            : await openTurn(context, session, { path: `/v1/connect/connectors/${connectorId}/build`, body: { message } });
    await followTurn(context, session, started, dir, options, wait);
}

export async function connectBuildFix(
    context: CliContext,
    runId: string,
    dir: string | undefined,
    options: BuildOptions,
    wait: BuildWait = BUILD_WAIT
): Promise<void> {
    const session: Session = sessionOf(context, options);
    const connectorId: string = connectorIdOf(options, dir);
    const started: Started = await openTurn(context, session, {
        path: `/v1/connect/connectors/${connectorId}/runs/${encodeURIComponent(runId)}/fix`,
        body: options.message === undefined ? {} : { message: options.message }
    });
    await followTurn(context, session, started, dir, options, wait);
}

export async function connectBuildShow(context: CliContext, dir: string | undefined, options: BuildOptions): Promise<void> {
    const session: Session = sessionOf(context, options);
    const conversation: Conversation = await fetchConversation(context, session, connectorIdOf(options, dir));
    if (options.json === true) {
        printJson(context, conversation);
        return;
    }
    printMessages(context, conversation.messages);
    if (conversation.answering) {
        printLine(context, 'A IA ainda está respondendo: rode `nexo connect build show` de novo daqui a pouco.');
    }
}
