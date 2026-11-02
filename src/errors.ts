import type { ExitCode } from './exit-codes.types.js';
import { EXIT_CODES } from './exit-codes.types.js';

export class CliError extends Error {
    public readonly exitCode: ExitCode;
    public readonly hint: string | null;

    public constructor(message: string, exitCode: ExitCode, hint: string | null = null) {
        super(message);
        this.name = 'CliError';
        this.exitCode = exitCode;
        this.hint = hint;
    }
}

export function usageError(message: string, hint: string | null = null): CliError {
    return new CliError(message, EXIT_CODES.usage, hint);
}

export function notLoggedIn(): CliError {
    return new CliError('Você não entrou no Nexo nesta máquina.', EXIT_CODES.unauthenticated, 'Rode `nexo login`, ou defina NEXO_TOKEN.');
}
