import { appUrlOf, AGENT_PAIRING_PAGE } from '../config/environments.js';
import type { Session } from '../config/session.js';
import { clientOf, printJson, printLine, printNotice, sessionOf } from '../context.js';
import type { CliContext } from '../context.js';
import { requestLocalChange } from '../connect/changes.js';
import { describeAgent, describeAgentRow, isAgent, isAgentList, isPairingCode, pairedSince, revokePreview } from '../connect/agents.js';
import type { Agent, PairingCode } from '../connect/agents.js';
import { CliError, usageError } from '../errors.js';
import { EXIT_CODES } from '../exit-codes.types.js';
import type { ApiResponse } from '../http/nexo-client.js';
import { pause } from '../documents/journey-api.js';
import type { ConnectRunOptions } from './connect-runs.js';

export interface AgentOptions extends Omit<ConnectRunOptions, 'confirm'> {
    /** Em `revoke` a confirmação é local (sem token). */
    readonly confirm?: boolean;
    readonly code?: boolean;
    readonly name?: string;
}

export interface PairWait {
    readonly intervalMs: number;
    readonly timeoutMs: number;
    /** O relógio da espera; o padrão é `Date.now`. */
    readonly now?: () => number;
}

export const PAIR_WAIT: PairWait = { intervalMs: 3000, timeoutMs: 10 * 60_000 };

async function fetchAgents(context: CliContext, session: Session): Promise<readonly Agent[]> {
    const response: ApiResponse = await clientOf(context, session).request({ method: 'GET', path: '/v1/connect/agents' });
    if (!isAgentList(response.body)) {
        throw new Error('Lista de agentes em formato inesperado.');
    }
    return response.body;
}

async function fetchAgent(context: CliContext, session: Session, agentId: string): Promise<Agent> {
    const response: ApiResponse = await clientOf(context, session).request({
        method: 'GET',
        path: `/v1/connect/agents/${encodeURIComponent(agentId)}`
    });
    if (!isAgent(response.body)) {
        throw new Error('Agente em formato inesperado.');
    }
    return response.body;
}

export async function agentsList(context: CliContext, options: AgentOptions): Promise<void> {
    const agents: readonly Agent[] = await fetchAgents(context, sessionOf(context, options));
    if (options.json === true) {
        printJson(context, agents);
        return;
    }
    if (agents.length === 0) {
        printLine(context, 'Nenhum agente local nesta empresa. Instale o primeiro com `nexo connect agents pair`.');
        return;
    }
    for (const agent of agents) {
        printLine(context, describeAgentRow(agent));
    }
}

export async function agentShow(context: CliContext, agentId: string, options: AgentOptions): Promise<void> {
    const agent: Agent = await fetchAgent(context, sessionOf(context, options), agentId);
    if (options.json === true) {
        printJson(context, agent);
        return;
    }
    for (const line of describeAgent(agent)) {
        printLine(context, line);
    }
}

async function createCode(context: CliContext, session: Session, options: AgentOptions): Promise<PairingCode> {
    try {
        const response: ApiResponse = await clientOf(context, session).request({
            method: 'POST',
            path: '/v1/connect/agents/pairing-codes',
            body: options.name === undefined ? {} : { name: options.name }
        });
        if (!isPairingCode(response.body)) {
            throw new Error('Código de pareamento em formato inesperado.');
        }
        return response.body;
    } catch (error) {
        if (error instanceof CliError && error.exitCode === EXIT_CODES.forbidden) {
            throw new CliError(
                error.message,
                EXIT_CODES.forbidden,
                'Só uma chave pessoal com o escopo connectors:hosts gera o código; com o login da CLI, rode `nexo connect agents pair` sem --code e gere o código na tela.'
            );
        }
        throw error;
    }
}

async function waitForPaired(context: CliContext, session: Session, since: number, wait: PairWait): Promise<Agent> {
    const now: () => number = wait.now ?? Date.now;
    const deadline: number = now() + wait.timeoutMs;
    for (;;) {
        const paired: Agent | null = pairedSince(await fetchAgents(context, session), since);
        if (paired !== null) {
            return paired;
        }
        if (now() >= deadline) {
            throw new CliError(
                'Nenhum agente novo foi pareado a tempo.',
                EXIT_CODES.failure,
                'Gere o código na tela, instale o agente com ele e confira com `nexo connect agents`.'
            );
        }
        await pause(context, wait.intervalMs);
    }
}

async function announcePairing(context: CliContext, session: Session, options: AgentOptions, url: string): Promise<void> {
    if (options.code === true) {
        const code: PairingCode = await createCode(context, session, options);
        printLine(context, `Código de pareamento: ${code.code} (vale uma vez, até ${code.expiresAt})`);
        printLine(context, 'Use-o na instalação do agente, na máquina da empresa.');
        return;
    }
    const opened: boolean = await context.openUrl(url);
    printNotice(context, opened ? 'Abri a aba Agente local no navegador.' : 'Abra a aba Agente local no navegador:');
    printNotice(context, opened ? `Se não abriu, use: ${url}` : url);
    printNotice(
        context,
        'Gere o código lá, com a sua sessão, e use-o na instalação do agente na máquina da empresa. O código não passa pela CLI.'
    );
}

export async function agentPair(context: CliContext, options: AgentOptions, wait: PairWait = PAIR_WAIT): Promise<void> {
    const session: Session = sessionOf(context, options);
    const now: () => number = wait.now ?? Date.now;
    const since: number = now();
    const url: string = `${appUrlOf(session.apiUrl)}${AGENT_PAIRING_PAGE}`;
    await announcePairing(context, session, options, url);
    if (options.wait === false) {
        return;
    }
    printNotice(context, 'Esperando um agente novo ser pareado (até 10 minutos)…');
    const agent: Agent = await waitForPaired(context, session, since, wait);
    if (options.json === true) {
        printJson(context, agent);
        return;
    }
    printLine(context, 'Agente pareado:');
    for (const line of describeAgent(agent)) {
        printLine(context, line);
    }
}

export async function agentRevoke(context: CliContext, agentId: string, options: AgentOptions): Promise<void> {
    const session: Session = sessionOf(context, options);
    const agent: Agent = await fetchAgent(context, session, agentId);
    if (agent.status === 'revoked') {
        throw usageError(`O agente ${agent.name} já está revogado.`, 'Para ter um agente de novo, rode `nexo connect agents pair`.');
    }
    await requestLocalChange(context, {
        preview: revokePreview(agent),
        command: `nexo connect agents revoke ${agentId}`,
        confirmed: options.confirm === true,
        yes: options.yes === true,
        json: options.json === true,
        apply: () =>
            clientOf(context, session).request({ method: 'POST', path: `/v1/connect/agents/${encodeURIComponent(agentId)}/revoke` }),
        report: () => {
            printLine(context, `Agente ${agent.name} revogado. O túnel foi cortado.`);
        }
    });
}
