import { startLoopbackServer } from '../auth/loopback-server.js';
import type { LoopbackServer } from '../auth/loopback-server.js';
import { authorizeUrl, exchangeCode } from '../auth/oauth.js';
import type { TokenSet } from '../auth/oauth.js';
import { pkcePair, randomToken } from '../auth/pkce.js';
import type { PkcePair } from '../auth/pkce.js';
import { oauthProfileOf } from '../auth/token-source.js';
import type { OAuthProfile } from '../config/credentials-store.js';
import { printNotice } from '../context.js';
import type { CliContext } from '../context.js';

export interface BrowserLogin {
    readonly apiUrl: string;
    readonly scope: string | null;
    readonly openBrowser: boolean;
    readonly timeoutMs: number;
}

export const LOGIN_TIMEOUT_MS: number = 5 * 60_000;

async function announce(context: CliContext, url: string, openBrowser: boolean): Promise<void> {
    const opened: boolean = openBrowser && (await context.openUrl(url));
    printNotice(
        context,
        opened
            ? 'Abri o Nexo no navegador para você autorizar a CLI.'
            : 'Abra este endereço no navegador desta máquina para autorizar a CLI:'
    );
    printNotice(context, opened ? `Se não abriu, use: ${url}` : url);
    if ((context.env.SSH_CONNECTION ?? '') !== '') {
        printNotice(context, 'Numa sessão SSH, o navegador precisa ser desta máquina. Senão, use `nexo login --token`.');
    }
}

export async function browserLogin(context: CliContext, login: BrowserLogin): Promise<OAuthProfile> {
    const server: LoopbackServer = await startLoopbackServer();
    try {
        const pkce: PkcePair = pkcePair();
        const state: string = randomToken();
        const url: string = authorizeUrl({
            apiUrl: login.apiUrl,
            redirectUri: server.redirectUri,
            challenge: pkce.challenge,
            state,
            scope: login.scope
        });
        await announce(context, url, login.openBrowser);
        printNotice(context, 'Esperando a autorização…');
        const code: string = await server.code({ state, issuer: login.apiUrl, timeoutMs: login.timeoutMs });
        const tokens: TokenSet = await exchangeCode(context.fetchFn, {
            apiUrl: login.apiUrl,
            code,
            redirectUri: server.redirectUri,
            verifier: pkce.verifier
        });
        return oauthProfileOf(login.apiUrl, tokens);
    } finally {
        server.close();
    }
}
