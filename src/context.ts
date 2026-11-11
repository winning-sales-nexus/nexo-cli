import type { Readable, Writable } from 'node:stream';
import { CredentialsStore } from './config/credentials-store.js';
import { profileName, requiredSession } from './config/session.js';
import type { Session } from './config/session.js';
import { OAuthTokenSource, staticTokenSource } from './auth/token-source.js';
import type { TokenSource } from './auth/token-source.js';
import type { UrlOpener } from './auth/open-browser.js';
import { openInBrowser } from './auth/open-browser.js';
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
    readonly openUrl: UrlOpener;
    readonly sleep?: (ms: number) => Promise<void>;
}

export function processContext(): CliContext {
    return {
        store: new CredentialsStore(),
        env: process.env,
        stdin: process.stdin,
        stdout: process.stdout,
        stderr: process.stderr,
        fetchFn: fetch,
        openUrl: openInBrowser
    };
}

export function sessionOf(context: CliContext, options: GlobalOptions): Session {
    return requiredSession(context.store, profileName(options.profile, context.env), context.env);
}

function tokenSourceOf(context: CliContext, session: Session): TokenSource {
    if (session.stored?.kind === 'oauth') {
        return new OAuthTokenSource(context.store, session.profile, session.stored, context.fetchFn);
    }
    return staticTokenSource(session.token);
}

export function clientOf(context: CliContext, session: Session): NexoClient {
    return new NexoClient(session.apiUrl, tokenSourceOf(context, session), context.fetchFn);
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
