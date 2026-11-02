import type { Readable, Writable } from 'node:stream';
import { CredentialsStore } from './config/credentials-store.js';
import { profileName, requiredSession } from './config/session.js';
import type { Session } from './config/session.js';
import { NexoClient } from './http/nexo-client.js';
import type { FetchFunction } from './http/nexo-client.js';

export interface GlobalOptions {
    readonly profile?: string;
    readonly json?: boolean;
}

export interface CliContext {
    readonly store: CredentialsStore;
    readonly env: NodeJS.ProcessEnv;
    readonly stdin: Readable & { readonly isTTY?: boolean };
    readonly stdout: Writable;
    readonly stderr: Writable;
    readonly fetchFn: FetchFunction;
}

export function processContext(): CliContext {
    return {
        store: new CredentialsStore(),
        env: process.env,
        stdin: process.stdin,
        stdout: process.stdout,
        stderr: process.stderr,
        fetchFn: fetch
    };
}

export function sessionOf(context: CliContext, options: GlobalOptions): Session {
    return requiredSession(context.store, profileName(options.profile, context.env), context.env);
}

export function clientOf(context: CliContext, session: Session): NexoClient {
    return new NexoClient(session.apiUrl, session.token, context.fetchFn);
}

export function printJson(context: CliContext, value: unknown): void {
    context.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function printLine(context: CliContext, text: string): void {
    context.stdout.write(`${text}\n`);
}

export function printNotice(context: CliContext, text: string): void {
    context.stderr.write(`${text}\n`);
}
