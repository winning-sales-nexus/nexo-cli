import { CliError } from '../errors.js';
import { EXIT_CODES } from '../exit-codes.types.js';
import type { ExitCode } from '../exit-codes.types.js';

export interface Problem {
    readonly type: string;
    readonly title: string;
    readonly status: number;
    readonly detail: string | null;
    readonly requestId: string | null;
    readonly meta?: Readonly<Record<string, unknown>>;
}

function textOf(value: unknown): string | null {
    return typeof value === 'string' && value !== '' ? value : null;
}

export function problemOf(status: number, body: unknown): Problem {
    const fields: Record<string, unknown> = typeof body === 'object' && body !== null ? { ...body } : {};
    return {
        type: textOf(fields.type) ?? 'about:blank',
        title: textOf(fields.title) ?? `A API respondeu ${String(status)}`,
        status,
        detail: textOf(fields.detail),
        requestId: textOf(fields.requestId),
        ...(isRecord(fields.meta) ? { meta: fields.meta } : {})
    };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sentenceOf(item: unknown): string | null {
    if (!isRecord(item)) {
        return textOf(item);
    }
    const label: string | null = textOf(item.label);
    const reason: string | null = textOf(item.reason);
    return textOf(item.sentence) ?? (label === null || reason === null ? null : `${label}: ${reason}`);
}

function listedIn(meta: Readonly<Record<string, unknown>> | undefined): string | null {
    const items: readonly unknown[] = [meta?.pending, meta?.problems, meta?.findings].flatMap((list: unknown) =>
        Array.isArray(list) ? (list as readonly unknown[]) : []
    );
    const lines: readonly string[] = items.map(sentenceOf).flatMap((line: string | null) => (line === null ? [] : [`  - ${line}`]));
    return lines.length === 0 ? null : lines.join('\n');
}

const EXIT_BY_STATUS: Readonly<Record<number, ExitCode>> = {
    401: EXIT_CODES.unauthenticated,
    403: EXIT_CODES.forbidden,
    404: EXIT_CODES.notFound,
    429: EXIT_CODES.rateLimited
};

const HINT_BY_STATUS: Readonly<Record<number, string>> = {
    401: 'Rode `nexo login` de novo, ou confira NEXO_TOKEN.',
    403: 'O token não tem o escopo, ou o seu perfil no Nexo não libera esta operação.',
    429: 'Espere um pouco: o limite é da empresa, somando todos os tokens.'
};

const HINT_BY_TYPE: Readonly<Record<string, string | null>> = {
    'public_api.platform_company_required': 'Escolha uma empresa: `nexo companies` lista, `nexo use <empresa>` escolhe.',
    'public_api.platform_connection_only': 'Só a conexão de plataforma (login do admin da empresa do Nexo) escolhe empresa.',
    'agents.writing_budget': null,
    'core.too_many_attempts': 'Espere alguns minutos: o limite é por pessoa e por empresa, somado ao do app.',
    'copilot.confirmation_stale': 'O modelo mudou depois da prévia: rode o comando de novo e confirme.',
    'brain.skill_shrink_needs_confirmation':
        'A edição tira item ou encolhe a skill em mais de 30%: mostre à pessoa e, depois do sim, rode de novo com --confirm-shrink.',
    'brain.layer_skill_refused':
        'O texto foi recusado (ordem ao assistente, número da empresa ou skill repetida): reescreva o item como um jeito de fazer.',
    'brain.skill_without_usage_condition': 'Falta dizer quando usar: ajuste o objetivo e o momento.',
    'connect.erp_operation_not_found': 'Veja as operações que você alcança com `nexo erp list`.',
    'plans.product_not_contracted': 'A empresa não tem o Nexo Connect no plano: peça a quem administra o Nexo para contratar.',
    'connect.operation_failed': 'O erro veio do outro sistema (o ERP), não do Nexo. Quem cuida do conector lê a execução citada e corrige.',
    'connect.operation_timeout': 'O outro sistema (o ERP) não respondeu a tempo; o Nexo está de pé. Tente de novo mais tarde.',
    'agents.template_required': 'Diga o modelo da versão nova com --template <id>.'
};

function hintOf(problem: Problem): string | null {
    const typed: string | null | undefined = HINT_BY_TYPE[problem.type];
    return typed === undefined ? (HINT_BY_STATUS[problem.status] ?? listedIn(problem.meta)) : typed;
}

export class NexoApiError extends CliError {
    public readonly problem: Problem;

    public constructor(problem: Problem) {
        super(NexoApiError.messageOf(problem), EXIT_BY_STATUS[problem.status] ?? EXIT_CODES.failure, hintOf(problem));
        this.name = 'NexoApiError';
        this.problem = problem;
    }

    private static messageOf(problem: Problem): string {
        const reference: string = problem.requestId === null ? '' : ` (pedido ${problem.requestId})`;
        const detail: string = problem.detail === null ? '' : `: ${problem.detail}`;
        return `${problem.title}${detail}${reference}`;
    }
}
