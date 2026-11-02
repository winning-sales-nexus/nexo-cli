import { CliError } from '../errors.js';
import { EXIT_CODES } from '../exit-codes.types.js';
import type { FetchFunction } from '../http/nexo-client.js';
import { USER_AGENT } from '../version.js';

export const CLI_CLIENT_ID: string = 'nexo-cli';

export interface TokenSet {
    readonly accessToken: string;
    readonly refreshToken: string;
    readonly expiresAt: string;
    readonly scope: string;
}

export interface AuthorizeRequest {
    readonly apiUrl: string;
    readonly redirectUri: string;
    readonly challenge: string;
    readonly state: string;
    readonly scope: string | null;
}

export function resourceOf(apiUrl: string): string {
    return `${apiUrl}/v1`;
}

export function authorizeUrl(request: AuthorizeRequest): string {
    const url: URL = new URL('/oauth/authorize', request.apiUrl);
    const params: Record<string, string> = {
        response_type: 'code',
        client_id: CLI_CLIENT_ID,
        redirect_uri: request.redirectUri,
        code_challenge: request.challenge,
        code_challenge_method: 'S256',
        state: request.state,
        resource: resourceOf(request.apiUrl)
    };
    for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
    }
    if (request.scope !== null) {
        url.searchParams.set('scope', request.scope);
    }
    return url.toString();
}

function textField(body: Record<string, unknown>, field: string): string | null {
    const value: unknown = body[field];
    return typeof value === 'string' && value !== '' ? value : null;
}

function tokenSetOf(body: Record<string, unknown>, now: Date): TokenSet | null {
    const accessToken: string | null = textField(body, 'access_token');
    const refreshToken: string | null = textField(body, 'refresh_token');
    const expiresIn: unknown = body.expires_in;
    if (accessToken === null || refreshToken === null || typeof expiresIn !== 'number') {
        return null;
    }
    const expiresAt: string = new Date(now.getTime() + expiresIn * 1000).toISOString();
    return { accessToken, refreshToken, expiresAt, scope: textField(body, 'scope') ?? '' };
}

async function postForm(fetchFn: FetchFunction, url: string, form: Readonly<Record<string, string>>): Promise<Response> {
    try {
        return await fetchFn(url, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', 'user-agent': USER_AGENT },
            body: new URLSearchParams(form).toString()
        });
    } catch (error: unknown) {
        const reason: string = error instanceof Error ? error.message : String(error);
        throw new CliError(`Não consegui falar com ${new URL(url).origin}: ${reason}.`, EXIT_CODES.failure);
    }
}

async function requestTokens(fetchFn: FetchFunction, apiUrl: string, form: Readonly<Record<string, string>>): Promise<TokenSet | null> {
    const response: Response = await postForm(fetchFn, new URL('/oauth/token', apiUrl).toString(), form);
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok || typeof body !== 'object' || body === null) {
        return null;
    }
    return tokenSetOf({ ...body }, new Date());
}

export interface CodeExchange {
    readonly apiUrl: string;
    readonly code: string;
    readonly redirectUri: string;
    readonly verifier: string;
}

export async function exchangeCode(fetchFn: FetchFunction, exchange: CodeExchange): Promise<TokenSet> {
    const tokens: TokenSet | null = await requestTokens(fetchFn, exchange.apiUrl, {
        grant_type: 'authorization_code',
        code: exchange.code,
        redirect_uri: exchange.redirectUri,
        client_id: CLI_CLIENT_ID,
        code_verifier: exchange.verifier,
        resource: resourceOf(exchange.apiUrl)
    });
    if (tokens === null) {
        throw new CliError('O Nexo recusou a troca do código de autorização.', EXIT_CODES.unauthenticated, 'Rode `nexo login` de novo.');
    }
    return tokens;
}

export async function refreshTokens(fetchFn: FetchFunction, apiUrl: string, refreshToken: string): Promise<TokenSet | null> {
    return requestTokens(fetchFn, apiUrl, { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: CLI_CLIENT_ID });
}

export async function revokeToken(fetchFn: FetchFunction, apiUrl: string, token: string): Promise<boolean> {
    const response: Response = await postForm(fetchFn, new URL('/oauth/revoke', apiUrl).toString(), { token, client_id: CLI_CLIENT_ID });
    return response.ok;
}
