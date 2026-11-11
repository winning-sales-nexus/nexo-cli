import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { UrlOpener } from '../src/auth/open-browser.js';
import { CredentialsStore } from '../src/config/credentials-store.js';
import type { OAuthProfile } from '../src/config/credentials-store.js';
import type { CliContext } from '../src/context.js';
import type { FetchFunction } from '../src/http/nexo-client.js';
import { run } from '../src/run.js';

const API: string = 'https://mcp-nexo.winningsales.com.br';

const ME: unknown = {
    user: { id: 'u1', name: 'Ana Souza', email: 'ana@empresa.com.br', profiles: [{ id: 'p1', name: 'Vendedor' }] },
    company: { id: 'c1', name: 'Empresa Teste', timezone: 'America/Sao_Paulo' },
    credential: { id: 'o1', name: 'Nexo CLI', kind: 'oauth', scopes: ['context:read'], expiresAt: '2027-01-31T12:00:00.000Z' },
    rateLimits: {}
};

interface Call {
    readonly url: string;
    readonly form: URLSearchParams | null;
    readonly authorization: string | undefined;
}

interface Harness {
    readonly context: CliContext;
    readonly calls: Call[];
    readonly err: () => string;
    readonly opened: string[];
}

type Answer = (call: Call) => Response;

function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function tokens(access: string, refresh: string, expiresIn: number = 3600): Response {
    return json(200, { access_token: access, refresh_token: refresh, expires_in: expiresIn, token_type: 'Bearer', scope: 'context:read' });
}

function browser(callback: (authorize: URL) => URLSearchParams, opened: string[]): UrlOpener {
    return (url: string) => {
        opened.push(url);
        const authorize: URL = new URL(url);
        const redirect: URL = new URL(authorize.searchParams.get('redirect_uri') ?? '');
        redirect.search = callback(authorize).toString();
        void fetch(redirect);
        return Promise.resolve(true);
    };
}

function approve(authorize: URL): URLSearchParams {
    return new URLSearchParams({ code: 'code-1', state: authorize.searchParams.get('state') ?? '', iss: API });
}

function harness(answer: Answer, opener?: (opened: string[]) => UrlOpener): Harness {
    const calls: Call[] = [];
    const opened: string[] = [];
    const stderr: PassThrough = new PassThrough();
    let err: string = '';
    stderr.on('data', (chunk: Buffer) => (err += chunk.toString()));
    const fetchFn: FetchFunction = (url: string, init: RequestInit) => {
        const headers: Record<string, string> = init.headers as Record<string, string>;
        const form: URLSearchParams | null =
            typeof init.body === 'string' && url.includes('/oauth/') ? new URLSearchParams(init.body) : null;
        const call: Call = { url, form, authorization: headers.authorization };
        calls.push(call);
        return Promise.resolve(answer(call));
    };
    const context: CliContext = {
        store: new CredentialsStore(mkdtempSync(join(tmpdir(), 'nexo-oauth-'))),
        env: {},
        stdin: Readable.from(['']),
        stdout: new PassThrough(),
        stderr,
        fetchFn,
        openUrl: (opener ?? ((list: string[]) => browser(approve, list)))(opened)
    };
    return { context, calls, err: () => err, opened };
}

function apiAnswer(call: Call): Response {
    if (call.url.endsWith('/oauth/token')) {
        return tokens('access-1', 'refresh-1');
    }
    return json(200, ME);
}

function savedOAuth(store: CredentialsStore): OAuthProfile {
    const profile: ReturnType<CredentialsStore['profile']> = store.profile('default');
    if (profile?.kind !== 'oauth') {
        throw new Error('no oauth profile');
    }
    return profile;
}

function expiredProfile(store: CredentialsStore): void {
    store.save('default', {
        kind: 'oauth',
        apiUrl: API,
        accessToken: 'old-access',
        refreshToken: 'old-refresh',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        scope: 'context:read',
        savedAt: new Date().toISOString()
    });
}

describe('nexo login (browser)', () => {
    it('authorizes with PKCE on a 127.0.0.1 callback, exchanges the code and saves the connection', async () => {
        const h: Harness = harness(apiAnswer);

        const code: number = await run(h.context, ['login']);

        expect(code).toBe(0);
        const authorize: URL = new URL(h.opened[0] ?? '');
        expect(authorize.origin + authorize.pathname).toBe(`${API}/oauth/authorize`);
        expect(authorize.searchParams.get('client_id')).toBe('nexo-cli');
        expect(authorize.searchParams.get('resource')).toBe(`${API}/v1`);
        expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
        expect(authorize.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
        const exchange: Call | undefined = h.calls.find((call) => call.url.endsWith('/oauth/token'));
        expect(exchange?.form?.get('grant_type')).toBe('authorization_code');
        expect(exchange?.form?.get('redirect_uri')).toBe(authorize.searchParams.get('redirect_uri'));
        const verifier: string = exchange?.form?.get('code_verifier') ?? '';
        expect(createHash('sha256').update(verifier).digest('base64url')).toBe(authorize.searchParams.get('code_challenge'));
        expect(h.calls.find((call) => call.url.endsWith('/v1/me'))?.authorization).toBe('Bearer access-1');
        expect(savedOAuth(h.context.store)).toMatchObject({ accessToken: 'access-1', refreshToken: 'refresh-1' });
    });

    it('sends the chosen scopes', async () => {
        const h: Harness = harness(apiAnswer);

        await run(h.context, ['login', '--scopes', 'context:read,connectors:write']);

        expect(new URL(h.opened[0] ?? '').searchParams.get('scope')).toBe('context:read connectors:write');
    });

    it('refuses a callback from another login and saves nothing', async () => {
        const forged = (list: string[]): UrlOpener => browser(() => new URLSearchParams({ code: 'x', state: 'other' }), list);
        const h: Harness = harness(apiAnswer, forged);

        const code: number = await run(h.context, ['login']);

        expect(code).toBe(3);
        expect(h.err()).toContain('state diferente');
        expect(h.calls.some((call) => call.url.endsWith('/oauth/token'))).toBe(false);
        expect(h.context.store.profile('default')).toBeNull();
    });

    it('says when the person denies access', async () => {
        const denied = (list: string[]): UrlOpener =>
            browser(
                (authorize: URL) => new URLSearchParams({ error: 'access_denied', state: authorize.searchParams.get('state') ?? '' }),
                list
            );
        const h: Harness = harness(apiAnswer, denied);

        expect(await run(h.context, ['login'])).toBe(3);
        expect(h.err()).toContain('negada');
    });
});

describe('the browser connection over time', () => {
    it('renews an expired access before calling, and keeps the rotated refresh token', async () => {
        const h: Harness = harness((call: Call) => (call.url.endsWith('/oauth/token') ? tokens('access-2', 'refresh-2') : json(200, ME)));
        expiredProfile(h.context.store);

        const code: number = await run(h.context, ['whoami']);

        expect(code).toBe(0);
        expect(h.calls[0]?.form?.get('grant_type')).toBe('refresh_token');
        expect(h.calls[0]?.form?.get('refresh_token')).toBe('old-refresh');
        expect(h.calls[1]?.authorization).toBe('Bearer access-2');
        expect(savedOAuth(h.context.store)).toMatchObject({ accessToken: 'access-2', refreshToken: 'refresh-2' });
    });

    it('renews once on a 401 and repeats the call', async () => {
        let first: boolean = true;
        const h: Harness = harness((call: Call) => {
            if (call.url.endsWith('/oauth/token')) {
                return tokens('access-2', 'refresh-2');
            }
            const status: number = first ? 401 : 200;
            first = false;
            return status === 401
                ? json(401, { type: 'public_api.invalid_credential', title: 'Credencial inválida', status: 401 })
                : json(200, ME);
        });
        h.context.store.save('default', { ...savedOrFresh(), expiresAt: new Date(Date.now() + 3_600_000).toISOString() });

        expect(await run(h.context, ['whoami'])).toBe(0);
        expect(h.calls.map((call) => call.url.replace(API, ''))).toEqual(['/v1/me', '/oauth/token', '/v1/me']);
    });

    it('asks to log in again and forgets the connection when the renewal is refused', async () => {
        const h: Harness = harness((call: Call) =>
            call.url.endsWith('/oauth/token') ? json(400, { error: 'invalid_grant' }) : json(200, ME)
        );
        expiredProfile(h.context.store);

        expect(await run(h.context, ['whoami'])).toBe(3);
        expect(h.err()).toContain('nexo login');
        expect(h.context.store.profile('default')).toBeNull();
    });

    it('revokes the connection on logout', async () => {
        const h: Harness = harness(() => json(200, {}));
        expiredProfile(h.context.store);

        expect(await run(h.context, ['logout'])).toBe(0);
        expect(h.calls[0]?.url).toBe(`${API}/oauth/revoke`);
        expect(h.calls[0]?.form?.get('token')).toBe('old-refresh');
        expect(h.context.store.profile('default')).toBeNull();
        expect(h.err()).toContain('revogado');
    });
});

function savedOrFresh(): OAuthProfile {
    return {
        kind: 'oauth',
        apiUrl: API,
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        scope: 'context:read',
        savedAt: new Date().toISOString()
    };
}
