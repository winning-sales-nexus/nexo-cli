import { afterEach, describe, expect, it } from 'vitest';
import { startLoopbackServer } from '../src/auth/loopback-server.js';
import type { CallbackExpectation, LoopbackServer } from '../src/auth/loopback-server.js';

const ISSUER: string = 'https://mcp-nexo.winningsales.com.br';

const EXPECTATION: CallbackExpectation = { state: 'state-1', issuer: ISSUER, timeoutMs: 5000 };

const servers: LoopbackServer[] = [];

interface Reply {
    readonly status: number;
    readonly contentType: string | null;
    readonly cacheControl: string | null;
    readonly html: string;
}

async function visit(path: string, query: Record<string, string>): Promise<{ reply: Reply; outcome: Promise<string> }> {
    const server: LoopbackServer = await startLoopbackServer();
    servers.push(server);
    const outcome: Promise<string> = server.code(EXPECTATION);
    outcome.catch(() => undefined);
    const url: URL = new URL(path, server.redirectUri);
    url.search = new URLSearchParams(query).toString();
    const response: Response = await fetch(url);
    const reply: Reply = {
        status: response.status,
        contentType: response.headers.get('content-type'),
        cacheControl: response.headers.get('cache-control'),
        html: await response.text()
    };
    return { reply, outcome };
}

function expectSelfContained(html: string): void {
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/\b(?:src|href|action|data)\s*=/i);
    expect(html).not.toMatch(/url\(/i);
    expect(html).not.toMatch(/<(?:iframe|object|embed|form)\b/i);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<link');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('@import');
    expect(html).toContain('lang="pt-BR"');
    expect(html).toContain('<main');
    expect(html).toContain('<title>');
}

afterEach(() => {
    for (const server of servers.splice(0)) server.close();
});

describe('loopback callback page', () => {
    it('shows the success state and hands the code over', async () => {
        const { reply, outcome } = await visit('/callback', { code: 'code-1', state: 'state-1', iss: ISSUER });

        expect(reply.status).toBe(200);
        expect(reply.contentType).toBe('text/html; charset=utf-8');
        expect(reply.cacheControl).toBe('no-store');
        expect(reply.html).toContain('<h1>Pronto</h1>');
        expect(reply.html).toContain('A CLI do Nexo recebeu o acesso. Pode fechar esta aba e voltar ao terminal.');
        expect(reply.html).toContain('<svg');
        expect(reply.html).toContain('prefers-color-scheme:dark');
        expectSelfContained(reply.html);
        await expect(outcome).resolves.toBe('code-1');
    });

    it('shows the error state with the way out when access is denied', async () => {
        const { reply, outcome } = await visit('/callback', { error: 'access_denied', state: 'state-1' });

        expect(reply.status).toBe(400);
        expect(reply.contentType).toBe('text/html; charset=utf-8');
        expect(reply.cacheControl).toBe('no-store');
        expect(reply.html).toContain('<h1>Não deu certo</h1>');
        expect(reply.html).toContain('A autorização foi negada no Nexo.');
        expect(reply.html).toContain('rode <code>nexo login</code> de novo');
        expectSelfContained(reply.html);
        await expect(outcome).rejects.toThrow('A autorização foi negada no Nexo.');
    });

    it('escapes text that comes from the callback URL', async () => {
        const { reply, outcome } = await visit('/callback', { error: '<script>alert(1)</script>', state: 'state-1' });

        expect(reply.status).toBe(400);
        expect(reply.html).not.toContain('<script');
        expect(reply.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        await expect(outcome).rejects.toThrow('O Nexo recusou a autorização');
    });

    it('answers other paths with the same design and no cache', async () => {
        const { reply } = await visit('/other', {});

        expect(reply.status).toBe(404);
        expect(reply.cacheControl).toBe('no-store');
        expect(reply.html).toContain('Este endereço só recebe a volta do login do Nexo.');
        expectSelfContained(reply.html);
    });
});
