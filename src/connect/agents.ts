export interface AgentReach {
    readonly kind: string;
    readonly host: string;
    readonly port?: number;
    readonly engine?: string;
    readonly database?: string;
}

export interface AgentConnector {
    readonly id: string;
    readonly name: string;
    readonly status: string;
}

export interface Agent {
    readonly id: string;
    readonly name: string;
    readonly status: 'active' | 'revoked';
    readonly connected: boolean;
    readonly agentVersion: string;
    readonly os: string;
    readonly arch: string;
    readonly hostname: string;
    readonly reach: readonly AgentReach[];
    readonly lastSeenAt: string | null;
    readonly pairedAt: string;
    readonly revokedAt: string | null;
    readonly connectors: readonly AgentConnector[];
}

export interface PairingCode {
    readonly code: string;
    readonly expiresAt: string;
    readonly name: string | null;
    readonly pairUrl: string;
}

export function isAgent(value: unknown): value is Agent {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const fields: Partial<Record<keyof Agent, unknown>> = value;
    return (
        typeof fields.id === 'string' &&
        typeof fields.name === 'string' &&
        typeof fields.status === 'string' &&
        typeof fields.pairedAt === 'string' &&
        Array.isArray(fields.connectors) &&
        Array.isArray(fields.reach)
    );
}

export function isAgentList(value: unknown): value is readonly Agent[] {
    return Array.isArray(value) && value.every(isAgent);
}

export function isPairingCode(value: unknown): value is PairingCode {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const fields: Partial<Record<keyof PairingCode, unknown>> = value;
    return typeof fields.code === 'string' && typeof fields.expiresAt === 'string';
}

function connectionOf(agent: Agent): string {
    if (agent.status === 'revoked') {
        return 'revogado';
    }
    return agent.connected ? 'conectado' : 'desconectado';
}

function connectorNames(agent: Agent): string {
    return agent.connectors.length === 0
        ? 'nenhum conector'
        : agent.connectors.map((connector: AgentConnector) => connector.name).join(', ');
}

export function describeAgentRow(agent: Agent): string {
    return `${agent.id}  ${connectionOf(agent).padEnd(12)} v${agent.agentVersion}  último contato ${agent.lastSeenAt ?? '-'}  ${agent.name}  (${connectorNames(agent)})`;
}

function describeReach(reach: AgentReach): string {
    const where: string = reach.port === undefined ? reach.host : `${reach.host}:${String(reach.port)}`;
    const extra: string = [reach.engine, reach.database].filter((part: string | undefined) => part !== undefined).join('/');
    return `${reach.kind} ${where}${extra === '' ? '' : ` (${extra})`}`;
}

export function describeAgent(agent: Agent): readonly string[] {
    return [
        `${agent.name}  ${agent.id}`,
        `  Estado: ${connectionOf(agent)}, versão ${agent.agentVersion}, último contato ${agent.lastSeenAt ?? '-'}`,
        `  Máquina: ${agent.hostname} (${agent.os}, ${agent.arch}), pareada em ${agent.pairedAt}`,
        ...(agent.revokedAt === null ? [] : [`  Revogado em ${agent.revokedAt}`]),
        `  Conectores: ${connectorNames(agent)}`,
        agent.reach.length === 0 ? '  A lista local dele não alcança nada que ele tenha informado.' : '  A lista local dele alcança:',
        ...agent.reach.map((reach: AgentReach) => `    - ${describeReach(reach)}`)
    ];
}

export function revokePreview(agent: Agent): { readonly title: string; readonly changes: readonly string[] } {
    return {
        title: `Revogar o agente local ${agent.name}`,
        changes: [
            `A máquina é ${agent.hostname} (${agent.os}, ${agent.arch}); o programa instalado nela fica parado até alguém desinstalá-lo.`,
            agent.connectors.length === 0
                ? 'Nenhum conector usa este agente agora.'
                : `Os conectores que passam por ele deixam de alcançar o ERP até o manifesto apontar para outro agente: ${connectorNames(agent)}.`,
            'O túnel é cortado na hora e sem volta: não há como reativá-lo. Para ter um agente de novo, instale outro com um código novo.'
        ]
    };
}

/** O agente ativo que não estava na lista de antes do pedido (o mais novo), sem depender de relógio; ou `null`. */
export function newlyPaired(agents: readonly Agent[], known: ReadonlySet<string>): Agent | null {
    const paired: readonly Agent[] = agents
        .filter((agent: Agent) => agent.status === 'active' && !known.has(agent.id))
        .sort((a: Agent, b: Agent) => b.pairedAt.localeCompare(a.pairedAt));
    return paired[0] ?? null;
}
