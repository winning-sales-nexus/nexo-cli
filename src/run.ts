import { CommanderError } from 'commander';
import { printNotice } from './context.js';
import type { CliContext } from './context.js';
import { CliError } from './errors.js';
import { EXIT_CODES } from './exit-codes.types.js';
import type { ExitCode } from './exit-codes.types.js';
import { NexoApiError } from './http/problem.js';
import { buildProgram } from './program.js';

function reportFailure(context: CliContext, error: unknown, json: boolean): ExitCode {
    if (error instanceof CommanderError) {
        return error.exitCode === 0 ? EXIT_CODES.ok : EXIT_CODES.usage;
    }
    if (!(error instanceof CliError)) {
        printNotice(context, `Erro inesperado: ${error instanceof Error ? error.message : String(error)}`);
        return EXIT_CODES.failure;
    }
    if (json && error instanceof NexoApiError) {
        context.stderr.write(`${JSON.stringify(error.problem)}\n`);
        return error.exitCode;
    }
    printNotice(context, `Erro: ${error.message}`);
    if (error.hint !== null) {
        printNotice(context, error.hint);
    }
    return error.exitCode;
}

export async function run(context: CliContext, argv: readonly string[]): Promise<ExitCode> {
    const program: ReturnType<typeof buildProgram> = buildProgram(context).exitOverride();
    try {
        await program.parseAsync([...argv], { from: 'user' });
        return EXIT_CODES.ok;
    } catch (error: unknown) {
        return reportFailure(context, error, argv.includes('--json'));
    }
}
