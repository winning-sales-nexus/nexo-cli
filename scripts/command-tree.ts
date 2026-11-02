import { PassThrough, Readable } from 'node:stream';
import type { Argument, Command, Option } from 'commander';
import { CredentialsStore } from '../src/config/credentials-store.js';
import type { CliContext } from '../src/context.js';
import { buildProgram } from '../src/program.js';
import { CLI_VERSION } from '../src/version.js';

export interface ArgumentEntry {
    readonly name: string;
    readonly description: string;
    readonly required: boolean;
    readonly variadic: boolean;
    readonly default: unknown;
}

export interface OptionEntry {
    readonly flags: string;
    readonly description: string;
    readonly required: boolean;
    readonly default: unknown;
    readonly choices: readonly string[] | null;
}

export interface CommandEntry {
    readonly name: string;
    readonly path: string;
    readonly aliases: readonly string[];
    readonly description: string;
    readonly arguments: readonly ArgumentEntry[];
    readonly options: readonly OptionEntry[];
    readonly commands: readonly CommandEntry[];
}

function argumentEntry(argument: Argument): ArgumentEntry {
    return {
        name: argument.name(),
        description: argument.description,
        required: argument.required,
        variadic: argument.variadic,
        default: argument.defaultValue ?? null
    };
}

function optionEntry(option: Option): OptionEntry {
    return {
        flags: option.flags,
        description: option.description,
        required: option.mandatory,
        default: option.defaultValue ?? null,
        choices: option.argChoices ?? null
    };
}

export function commandTree(command: Command, parent: string = ''): CommandEntry {
    const path: string = parent === '' ? command.name() : `${parent} ${command.name()}`;
    return {
        name: command.name(),
        path,
        aliases: command.aliases(),
        description: command.description(),
        arguments: command.registeredArguments.map(argumentEntry),
        options: command.options.map(optionEntry),
        commands: command.commands.filter((child: Command) => child.name() !== 'help').map((child: Command) => commandTree(child, path))
    };
}

export interface CliReference {
    readonly version: string;
    readonly program: CommandEntry;
}

function silentContext(): CliContext {
    return {
        store: new CredentialsStore('/nonexistent'),
        env: {},
        stdin: Readable.from(['']),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        fetchFn: () => Promise.reject(new Error('offline')),
        openUrl: () => Promise.resolve(false)
    };
}

export function cliReference(): CliReference {
    return { version: CLI_VERSION, program: commandTree(buildProgram(silentContext())) };
}
