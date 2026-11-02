import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { CredentialsStore } from '../src/config/credentials-store.js';
import type { CliContext } from '../src/context.js';
import type { FetchFunction } from '../src/http/nexo-client.js';
import { run } from '../src/run.js';

const TOKEN: string = `nexo_pat_${'a'.repeat(38)}`;

const ME: unknown = {
    user: { id: 'u1', name: 'Ana Souza', email: 'ana@empresa.com.br', role: 'sales_lead' },
    company: { id: 'c1', name: 'Empresa Teste', timezone: 'America/Sao_Paulo' },
    credential: { id: 't1', name: 'cli', kind: 'pat', scopes: ['deals:read'], expiresAt: '2027-01-31T12:00:00.000Z' },
    rateLimits: {}
};

interface Call {
    readonly url: string;
    readonly init: RequestInit;
}

interface Harness {
    readonly context: CliContext;
    readonly calls: Call[];
    readonly out: () => string;
    readonly err: () => string;
    readonly directory: string;
}

function json(status: number, body: unknown, type: string = 'application/json'): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': type } });
}

function harness(answer: (call: Call) => Response, options: { stdin?: string; env?: NodeJS.ProcessEnv } = {}): Harness {
    const directory: string = mkdtempSync(join(tmpdir(), 'nexo-cli-'));
    const calls: Call[] = [];
    const stdout: PassThrough = new PassThrough();
    const stderr: PassThrough = new PassThrough();
    let out: string = '';
    let err: string = '';
    stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    stderr.on('data', (chunk: Buffer) => (err += chunk.toString()));
    const fetchFn: FetchFunction = (url: string, init: RequestInit) => {
        const call: Call = { url, init };
        calls.push(call);
        return Promise.resolve(answer(call));
    };
    const context: CliContext = {
        store: new CredentialsStore(directory),
        env: options.env ?? {},
        stdin: Readable.from([options.stdin ?? '']),
        stdout,
        stderr,
        fetchFn,
        openUrl: () => Promise.resolve(false)
    };
    return { context, calls, out: () => out, err: () => err, directory };
}

function header(call: Call, name: string): string | undefined {
    return (call.init.headers as Record<string, string>)[name];
}

describe('nexo login --with-token', () => {
    it('checks the token against /v1/me and saves the profile only readable by the owner', async () => {
        const h: Harness = harness(() => json(200, ME), { stdin: `${TOKEN}\n` });

        const code: number = await run(h.context, ['login', '--with-token']);

        expect(code).toBe(0);
        expect(h.calls[0]?.url).toBe('https://mcp-nexo.winningsales.com.br/v1/me');
        expect(header(h.calls[0] as Call, 'authorization')).toBe(`Bearer ${TOKEN}`);
        expect(header(h.calls[0] as Call, 'user-agent')).toMatch(/^nexo-cli\//);
        const file: string = join(h.directory, 'credentials.json');
        expect(statSync(file).mode & 0o777).toBe(0o600);
        expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ profiles: { default: { token: TOKEN, kind: 'pat' } } });
        expect(h.out()).toContain('Ana Souza <ana@empresa.com.br>, líder de vendas');
    });

    it('saves to the dev API when asked, under the chosen profile', async () => {
        const h: Harness = harness(() => json(200, ME), { stdin: TOKEN });

        await run(h.context, ['login', '--with-token', '--env', 'dev', '--profile', 'dev']);

        expect(h.calls[0]?.url).toBe('https://mcp-nexo-dev.winningsales.com.br/v1/me');
        expect(h.context.store.profile('dev')?.apiUrl).toBe('https://mcp-nexo-dev.winningsales.com.br');
        expect(h.context.store.profile('default')).toBeNull();
    });

    it('refuses something that is not a personal token without calling the API', async () => {
        const h: Harness = harness(() => json(200, ME), { stdin: 'sk-123' });

        const code: number = await run(h.context, ['login', '--with-token']);

        expect(code).toBe(2);
        expect(h.calls).toHaveLength(0);
        expect(h.err()).toContain('não parece um token pessoal');
    });

    it('does not save a token the API rejects, and says why in Portuguese', async () => {
        const problem: unknown = { type: 'public_api.invalid_credential', title: 'Credencial inválida', status: 401, requestId: 'r1' };
        const h: Harness = harness(() => json(401, problem, 'application/problem+json'), { stdin: TOKEN });

        const code: number = await run(h.context, ['login', '--with-token']);

        expect(code).toBe(3);
        expect(h.context.store.profile('default')).toBeNull();
        expect(h.err()).toContain('Credencial inválida (pedido r1)');
    });
});

describe('nexo whoami and logout', () => {
    it('asks to log in when there is no profile and no NEXO_TOKEN', async () => {
        const h: Harness = harness(() => json(200, ME));

        const code: number = await run(h.context, ['whoami']);

        expect(code).toBe(3);
        expect(h.err()).toContain('nexo login');
    });

    it('prefers NEXO_TOKEN and NEXO_API_URL from the environment', async () => {
        const h: Harness = harness(() => json(200, ME), { env: { NEXO_TOKEN: TOKEN, NEXO_API_URL: 'http://localhost:3334' } });

        const code: number = await run(h.context, ['whoami', '--json']);

        expect(code).toBe(0);
        expect(h.calls[0]?.url).toBe('http://localhost:3334/v1/me');
        expect(JSON.parse(h.out())).toEqual(ME);
    });

    it('refuses plain http outside the own machine', async () => {
        const h: Harness = harness(() => json(200, ME), { env: { NEXO_TOKEN: TOKEN, NEXO_API_URL: 'http://api.example.com' } });

        const code: number = await run(h.context, ['whoami']);

        expect(code).toBe(2);
        expect(h.calls).toHaveLength(0);
    });

    it('removes the saved profile on logout', async () => {
        const h: Harness = harness(() => json(200, ME), { stdin: TOKEN });
        await run(h.context, ['login', '--with-token']);

        await run(h.context, ['logout']);

        expect(h.context.store.profile('default')).toBeNull();
        expect(h.out()).toContain('Perfil default removido');
    });
});

describe('nexo api', () => {
    it('sends fields as the query string with -X GET and prefixes /v1', async () => {
        const h: Harness = harness(() => json(200, { items: [] }), { env: { NEXO_TOKEN: TOKEN } });

        const code: number = await run(h.context, ['api', 'deals', '-X', 'GET', '-f', 'limit=5', '-F', 'open=true']);

        expect(code).toBe(0);
        expect(h.calls[0]?.url).toBe('https://mcp-nexo.winningsales.com.br/v1/deals?limit=5&open=true');
        expect(h.calls[0]?.init.method).toBe('GET');
        expect(JSON.parse(h.out())).toEqual({ items: [] });
    });

    it('sends typed fields as a JSON body on POST', async () => {
        const h: Harness = harness(() => json(201, { id: 'n1' }), { env: { NEXO_TOKEN: TOKEN } });

        await run(h.context, ['api', '/v1/context-notes', '-X', 'post', '-f', 'text=oi', '-F', 'pinned=true', '-F', 'tags=["a"]']);

        expect(h.calls[0]?.init.method).toBe('POST');
        expect(header(h.calls[0] as Call, 'content-type')).toBe('application/json');
        expect(JSON.parse(h.calls[0]?.init.body as string)).toEqual({ text: 'oi', pinned: true, tags: ['a'] });
    });

    it('reads the body from stdin with --input -', async () => {
        const h: Harness = harness(() => json(200, {}), { env: { NEXO_TOKEN: TOKEN }, stdin: '{"a":1}' });

        await run(h.context, ['api', 'connect/connectors', '--input', '-']);

        expect(h.calls[0]?.init.method).toBe('POST');
        expect(JSON.parse(h.calls[0]?.init.body as string)).toEqual({ a: 1 });
    });

    it('prints the problem as JSON on stderr with --json and exits by status', async () => {
        const problem: unknown = { type: 'public_api.forbidden', title: 'Sem permissão', status: 403 };
        const h: Harness = harness(() => json(403, problem, 'application/problem+json'), { env: { NEXO_TOKEN: TOKEN } });

        const code: number = await run(h.context, ['api', 'admin/members', '--json']);

        expect(code).toBe(4);
        expect(JSON.parse(h.err())).toMatchObject({ type: 'public_api.forbidden', status: 403 });
    });
});
