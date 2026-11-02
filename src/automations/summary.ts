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

function nodeMap(document: Record<string, unknown>): Map<string, FlowNode> {
    return new Map(nodesOf(document).map((node: FlowNode) => [node.key, node]));
}

function edgeSet(document: Record<string, unknown>): Set<string> {
    const edges: unknown = document.edges;
    return new Set(Array.isArray(edges) ? edges.map((edge: unknown) => JSON.stringify(edge)) : []);
}

function nodeLine(prefix: string, node: FlowNode): string {
    return `  ${prefix} ${TYPE_LABELS[node.type] ?? node.type} ${node.key}${node.kind === undefined ? '' : ` (${node.kind})`}`;
}

export function describeDiff(live: Record<string, unknown>, draft: Record<string, unknown>): readonly string[] {
    const before: Map<string, FlowNode> = nodeMap(live);
    const after: Map<string, FlowNode> = nodeMap(draft);
    const removed: readonly string[] = [...before.values()]
        .filter((node: FlowNode) => !after.has(node.key))
        .map((node: FlowNode) => nodeLine('-', node));
    const changes: readonly string[] = [...after.values()].flatMap((node: FlowNode): readonly string[] => {
        const old: FlowNode | undefined = before.get(node.key);
        if (old === undefined) {
            return [nodeLine('+', node)];
        }
        return sameDocument(old, node) ? [] : [nodeLine('~', node)];
    });
    const oldEdges: Set<string> = edgeSet(live);
    const newEdges: Set<string> = edgeSet(draft);
    const edgesChanged: boolean = oldEdges.size !== newEdges.size || [...newEdges].some((edge: string) => !oldEdges.has(edge));
    return [...removed, ...changes, ...(edgesChanged ? ['  ~ As ligações entre os passos mudaram.'] : [])];
}
