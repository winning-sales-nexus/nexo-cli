import { knownAppUrl } from '../config/environments.js';
import type { Session } from '../config/session.js';
import { clientOf, printJson, printLine, printNotice, sessionOf } from '../context.js';
import type { CliContext } from '../context.js';
import { DEFAULT_PATIENCE, pollUntil, timedOut } from '../connect/access.js';
import type { Patience } from '../connect/access.js';
import { showPreview } from '../connect/changes.js';
import { STATE_FILE } from '../connect/project.js';
import { CliError, usageError } from '../errors.js';
import { EXIT_CODES } from '../exit-codes.types.js';
import type { ApiResponse } from '../http/nexo-client.js';
import { pause } from '../documents/journey-api.js';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { Interface } from 'node:readline';
import { join } from 'node:path';
import { fetchConnector } from './connect-files.js';
import type { ConnectorView } from './connect-files.js';
import { connectorIdOf } from './connect-runs.js';
import type { ConnectRunOptions } from './connect-runs.js';

/** O `GET` do conector traz `approvedHosts` dentro de `connector` e `pendingHosts` ao lado. */
export interface HostsState {
    readonly approved: readonly string[];
    readonly pending: readonly string[];
}

export function hostsOf(view: ConnectorView): HostsState {
    const approved: unknown = (view.connector as { approvedHosts?: unknown }).approvedHosts;
    return {
        approved: Array.isArray(approved) ? (approved as readonly string[]) : [],
        pending: Array.isArray(view.pendingHosts) ? view.pendingHosts : []
    };
}

/** A tela do conector aberta no ponto certo (`foco`, nexu-fe#1520), a partir do `link` que o Nexo devolve. */
export function screenLink(view: ConnectorView, focus: string): string {
    const url: URL = new URL(view.link);
    url.searchParams.set('foco', focus);
    return url.toString();
}

/** Abre a página no navegador; com a API de um ambiente que não conheço, só mostra o link. */
export async function openOrShow(context: CliContext, session: Session, url: string, what: string): Promise<void> {
    if (knownAppUrl(session.apiUrl) === null) {
        printNotice(context, `Não conheço o app do ambiente ${session.apiUrl}, então não abri o navegador.`);
        printNotice(context, `Abra ${what}: ${url}`);
        return;
    }
    const opened: boolean = await context.openUrl(url);
    printNotice(context, opened ? `Abri ${what} no navegador.` : `Abra ${what} no navegador:`);
    printNotice(context, opened ? `Se não abriu, use: ${url}` : url);
}

export async function hostsList(context: CliContext, dir: string | undefined, options: ConnectRunOptions): Promise<void> {
    const view: ConnectorView = await fetchConnector(context, sessionOf(context, options), connectorIdOf(options, dir));
    const hosts: HostsState = hostsOf(view);
    if (options.json === true) {
        printJson(context, { approvedHosts: hosts.approved, pendingHosts: hosts.pending });
        return;
    }
    printLine(context, `Aprovados: ${hosts.approved.join(', ') || 'nenhum'}.`);
    printLine(context, `Esperando o sim de uma pessoa: ${hosts.pending.join(', ') || 'nenhum'}.`);
    if (hosts.pending.length > 0) {
        printLine(context, 'Aprove com `nexo connect hosts approve`.');
    }
}

export type HostsApproveOptions = ConnectRunOptions;

/** Os argumentos são hosts; o último vira a pasta se for uma pasta de conector. */
function splitArguments(args: readonly string[]): { readonly hosts: readonly string[]; readonly dir: string | undefined } {
    const last: string | undefined = args.at(-1);
    if (last !== undefined && existsSync(join(last, STATE_FILE))) {
        return { hosts: args.slice(0, -1), dir: last };
    }
    return { hosts: args, dir: undefined };
}

/**
 * Só uma chave pessoal (`nexo_pat_`), com uma pessoa no terminal, pede a aprovação ao `/v1`; qualquer outro token segue
 * como o do `nexo login` (nenhum recebe `connectors:hosts`) e vai pela tela. Sem terminal, também vai pela tela:
 * nenhum comando que um agente rode aprova host.
 */
function approvesWithKey(context: CliContext, session: Session): boolean {
    return session.token.startsWith('nexo_pat_') && context.stdin.isTTY === true;
}

function hostsToApprove(wanted: readonly string[], state: HostsState): readonly string[] {
    const approved: ReadonlySet<string> = new Set(state.approved);
    const pending: ReadonlySet<string> = new Set(state.pending);
    for (const host of wanted) {
        if (!pending.has(host) && !approved.has(host)) {
            throw usageError(
                `O host ${host} não está entre os que a versão em edição pede.`,
                `Os que esperam o sim: ${state.pending.join(', ') || 'nenhum'}. Suba a versão com \`nexo connect push\` se o host é novo.`
            );
        }
    }
    return (wanted.length === 0 ? state.pending : wanted).filter((host: string) => !approved.has(host));
}

async function typedApproval(context: CliContext, hosts: readonly string[]): Promise<boolean> {
    const reader: Interface = createInterface({ input: context.stdin, output: context.stderr, terminal: true });
    try {
        const answer: string = await new Promise<string>((resolve: (text: string) => void) => {
            reader.question(`Para aprovar, digite "aprovar"${hosts.length === 1 ? ` ou o host (${hosts[0] ?? ''})` : ''}: `, resolve);
        });
        const typed: string = answer.trim().toLowerCase();
        return typed === 'aprovar' || (hosts.length === 1 && typed === hosts[0]?.toLowerCase());
    } finally {
        reader.close();
    }
}

async function previewApproval(
    context: CliContext,
    session: Session,
    base: string,
    hosts: readonly string[]
): Promise<ApprovalPreview | null> {
    try {
        const response: ApiResponse = await clientOf(context, session).request({
            method: 'POST',
            path: `${base}/hosts/approve/preview`,
            body: { hosts }
        });
        if (!isApprovalPreview(response.body)) {
            throw new Error('Prévia em formato inesperado.');
        }
        return response.body;
    } catch (error: unknown) {
        if (error instanceof CliError && error.exitCode === EXIT_CODES.forbidden) {
            printNotice(context, 'Esta chave não tem o escopo connectors:hosts; a aprovação vai pela tela.');
            return null;
        }
        throw error;
    }
}

interface ApprovalPreview {
    readonly title: string;
    readonly changes: readonly string[];
    readonly confirmation: { readonly token: string };
}

function isApprovalPreview(value: unknown): value is ApprovalPreview {
    const fields: Partial<Record<keyof ApprovalPreview, unknown>> | null = typeof value === 'object' ? value : null;
    return fields !== null && typeof fields.title === 'string' && Array.isArray(fields.changes) && typeof fields.confirmation === 'object';
}

/** Chave pessoal com o escopo, numa pessoa no terminal: prévia do `/v1` e a pessoa digita para aplicar. `false`: sem o escopo, vai pela tela. */
async function approveWithKey(
    context: CliContext,
    session: Session,
    connectorId: string,
    hosts: readonly string[],
    options: HostsApproveOptions
): Promise<boolean> {
    const base: string = `/v1/connect/connectors/${connectorId}`;
    const preview: ApprovalPreview | null = await previewApproval(context, session, base, hosts);
    if (preview === null) {
        return false;
    }
    showPreview(context, preview);
    if (!(await typedApproval(context, hosts))) {
        printNotice(context, 'Nada mudou.');
        return true;
    }
    const response: ApiResponse = await clientOf(context, session).request({
        method: 'POST',
        path: `${base}/hosts/approve`,
        body: { hosts, confirmationToken: preview.confirmation.token }
    });
    if (options.json === true) {
        printJson(context, response.body);
        return true;
    }
    printLine(context, `Aprovados: ${hosts.join(', ')}.`);
    return true;
}

function announce(context: CliContext, targets: readonly string[]): void {
    printNotice(context, 'Cada host aprovado passa a receber as chamadas do conector com os segredos dele:');
    for (const host of targets) {
        printNotice(context, `  - ${host}`);
    }
    printNotice(context, 'Confira que cada um é do sistema que o conector integra. A aprovação é sua, na tela, com a sua sessão.');
}

/** Espera todos os hosts estarem entre os aprovados; o que vale é o estado lido, não o relógio. */
async function waitForApproval(
    context: CliContext,
    session: Session,
    connectorId: string,
    targets: readonly string[],
    patience: Patience
): Promise<readonly string[]> {
    return pollUntil(
        async () => {
            const approved: ReadonlySet<string> = new Set(hostsOf(await fetchConnector(context, session, connectorId)).approved);
            return targets.every((host: string) => approved.has(host)) ? [...approved] : null;
        },
        (ms: number) => pause(context, ms),
        patience,
        timedOut(
            `Os hosts ${targets.join(', ')} não foram aprovados a tempo.`,
            'Aprove na tela do conector e confira com `nexo connect hosts`.'
        )
    );
}

export async function hostsApprove(
    context: CliContext,
    args: readonly string[],
    options: HostsApproveOptions,
    patience: Patience = DEFAULT_PATIENCE
): Promise<void> {
    const { hosts: wanted, dir } = splitArguments(args);
    const session: Session = sessionOf(context, options);
    const connectorId: string = connectorIdOf(options, dir);
    const view: ConnectorView = await fetchConnector(context, session, connectorId);
    const targets: readonly string[] = hostsToApprove(wanted, hostsOf(view));
    if (targets.length === 0) {
        printLine(context, 'Nenhum host esperando o sim.');
        return;
    }
    announce(context, targets);
    if (approvesWithKey(context, session) && (await approveWithKey(context, session, connectorId, targets, options))) {
        return;
    }
    await openOrShow(context, session, screenLink(view, 'hosts'), 'a tela do conector, nos hosts');
    if (options.wait === false) {
        return;
    }
    printNotice(context, 'Esperando a aprovação na tela (até 10 minutos)…');
    const approved: readonly string[] = await waitForApproval(context, session, connectorId, targets, patience);
    if (options.json === true) {
        printJson(context, { approvedHosts: approved });
        return;
    }
    printLine(context, `Aprovados: ${targets.join(', ')}.`);
}
