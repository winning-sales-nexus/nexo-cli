export interface FlowProblem {
    readonly key: string | null;
    readonly code: string;
    readonly reason: string;
}

interface FlowNode {
    readonly key: string;
    readonly type: string;
    readonly kind?: string;
}

function nodesOf(document: Record<string, unknown>): readonly FlowNode[] {
    const nodes: unknown = document.nodes;
    if (!Array.isArray(nodes)) {
        return [];
    }
    return nodes.filter(
        (node: unknown): node is FlowNode => typeof node === 'object' && node !== null && typeof (node as FlowNode).key === 'string'
    );
}

const TYPE_LABELS: Readonly<Record<string, string>> = {
    trigger: 'Gatilho',
    condition: 'Condição',
    wait: 'Espera',
    action: 'Ação',
    end: 'Fim'
};

export function describeDocument(document: Record<string, unknown>): readonly string[] {
    return nodesOf(document).map((node: FlowNode) => {
        const label: string = TYPE_LABELS[node.type] ?? node.type;
        return `  ${label} ${node.key}${node.kind === undefined ? '' : ` (${node.kind})`}`;
    });
}

export function describeProblems(problems: readonly FlowProblem[]): readonly string[] {
    return problems.map(
        (problem: FlowProblem) => `  ${problem.key === null ? 'regra' : `passo ${problem.key}`}: ${problem.reason} [${problem.code}]`
    );
}

export function sameDocument(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}
