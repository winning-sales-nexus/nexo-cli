import { CliError } from '../errors.js';
import { EXIT_CODES } from '../exit-codes.types.js';
import type { ExitCode } from '../exit-codes.types.js';

export interface Problem {
    readonly type: string;
    readonly title: string;
    readonly status: number;
    readonly detail: string | null;
    readonly requestId: string | null;
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
        requestId: textOf(fields.requestId)
    };
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

export class NexoApiError extends CliError {
    public readonly problem: Problem;

    public constructor(problem: Problem) {
        super(
            NexoApiError.messageOf(problem),
            EXIT_BY_STATUS[problem.status] ?? EXIT_CODES.failure,
            HINT_BY_STATUS[problem.status] ?? null
        );
        this.name = 'NexoApiError';
        this.problem = problem;
    }

    private static messageOf(problem: Problem): string {
        const reference: string = problem.requestId === null ? '' : ` (pedido ${problem.requestId})`;
        const detail: string = problem.detail === null ? '' : `: ${problem.detail}`;
        return `${problem.title}${detail}${reference}`;
    }
}
