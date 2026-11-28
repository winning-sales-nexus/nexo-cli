import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { CredentialsStore } from '../src/config/credentials-store.js';
import type { CliContext } from '../src/context.js';
import type { FetchFunction } from '../src/http/nexo-client.js';
import { run } from '../src/run.js';

const API: string = 'https://mcp-nexo.winningsales.com.br';
const ACOPLAST: string = '0192b2f0-0000-7000-8000-00000000a001';
const ACME: string = '0192b2f0-0000-7000-8000-00000000a002';
const ACME_SUL: string = '0192b2f0-0000-7000-8000-00000000a003';

const ALL: readonly unknown[] = [
    { id: ACOPLAST, name: 'Acoplast', suspended: false },
    { id: ACME, name: 'Acme', suspended: false },
    { id: ACME_SUL, name: 'Acme Sul', suspended: true }
];

function meOf(platform: unknown): unknown {
    return {
        user: { id: 'u1', name: 'Lucas', email: 'lucas@nexo.com', profiles: [{ id: 'p1', name: 'Admin' }] },
        company: { id: 'c1', name: 'Nexo', timezone: 'America/Sao_Paulo' },
        credential: { id: 't1', name: 'cli', kind: 'oauth', scopes: ['deals:read'], expiresAt: '2027-01-31T12:00:00.000Z' },
        rateLimits: {},
        platform
    };
}

interface Call {
    readonly method: string;
    readonly path: string;
    readonly body: string | null;
}

interface Harness {
    readonly context: CliContext;
    readonly calls: Call[];
    readonly out: () => string;
    readonly err: () => string;
}

function harness(answer: (call: Call) => Response): Harness {
    const calls: Call[] = [];
    const stdout: PassThrough = new PassThrough();
    const stderr: PassThrough = new PassThrough();
    let out: string = '';
    let err: string = '';
    stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    stderr.on('data', (chunk: Buffer) => (err += chunk.toString()));
    const fetchFn: FetchFunction = (url: string, init: RequestInit) => {
        const call: Call = {
            method: init.method ?? 'GET',
            path: url.replace(API, ''),
            body: typeof init.body === 'string' ? init.body : null
        };
        calls.push(call);
        return Promise.resolve(answer(call));
    };
    const context: CliContext = {
        store: new CredentialsStore(mkdtempSync(join(tmpdir(), 'nexo-platform-'))),
        env: { NEXO_TOKEN: `nexo_pat_${'e'.repeat(38)}` },
        stdin: Readable.from(['']),
        stdout,
        stderr,
        fetchFn,
        openUrl: () => Promise.resolve(false)
    };
    return { context, calls, out: () => out, err: () => err };
}

function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function platformApi(call: Call): Response {
    if (call.path.startsWith('/v1/platform/companies')) {
        const search: string | null = new URL(`${API}${call.path}`).searchParams.get('search');
        const found: readonly unknown[] =
            search === null
                ? ALL
                : ALL.filter((company) => (company as { name: string }).name.toLowerCase().includes(search.toLowerCase()));
        return json(200, { companies: found });
    }
    if (call.method === 'PUT') {
        return json(
            200,
            ALL.find((company) => (company as { id: string }).id === (JSON.parse(call.body ?? '{}') as { companyId: string }).companyId)
        );
    }
    return new Response(null, { status: 204 });
}

describe('nexo companies', () => {
    it('lists the companies, passes the search, and marks the suspended one', async () => {
        const h: Harness = harness(platformApi);

        expect(await run(h.context, ['companies'])).toBe(0);
        expect(h.out()).toContain(`${ACOPLAST}  Acoplast`);
        expect(h.out()).toContain('Acme Sul  (suspensa por cobrança: só leitura)');

        const searched: Harness = harness(platformApi);
        await run(searched.context, ['companies', 'acme']);
        expect(searched.calls[0]?.path).toBe('/v1/platform/companies?search=acme');
        expect(searched.out()).not.toContain('Acoplast');
    });

    it('explains that the connection is not a platform one', async () => {
        const h: Harness = harness(() =>
            json(404, {
                type: 'public_api.platform_connection_only',
                title: 'Não existe',
                status: 404,
                detail: 'Só da conexão de plataforma.'
            })
        );

        expect(await run(h.context, ['companies'])).toBe(5);
        expect(h.err()).toContain('conexão de plataforma');
    });
});

describe('nexo use', () => {
    it('chooses by id, without searching by name', async () => {
        const h: Harness = harness(platformApi);

        expect(await run(h.context, ['use', ACOPLAST])).toBe(0);

        expect(h.calls.map((call: Call) => `${call.method} ${call.path}`)).toEqual([
            'GET /v1/platform/companies',
            'PUT /v1/platform/active-company'
        ]);
        expect(JSON.parse(h.calls[1]?.body ?? '{}')).toEqual({ companyId: ACOPLAST });
        expect(h.out()).toContain(`Empresa ativa: Acoplast (${ACOPLAST})`);
    });

    it('chooses by a name that matches one company', async () => {
        const h: Harness = harness(platformApi);

        expect(await run(h.context, ['use', 'acopl'])).toBe(0);

        expect(JSON.parse(h.calls[1]?.body ?? '{}')).toEqual({ companyId: ACOPLAST });
    });

    it('prefers the exact name when another name contains it', async () => {
        const h: Harness = harness(platformApi);

        expect(await run(h.context, ['use', 'acme'])).toBe(0);

        expect(JSON.parse(h.calls[1]?.body ?? '{}')).toEqual({ companyId: ACME });
    });

    it('lists the options and chooses none when the name is ambiguous', async () => {
        const h: Harness = harness(platformApi);

        expect(await run(h.context, ['use', 'ac'])).toBe(2);

        expect(h.err()).toContain('casa com 3 empresas');
        expect(h.err()).toContain(`${ACME_SUL}  Acme Sul`);
        expect(h.calls.some((call: Call) => call.method === 'PUT')).toBe(false);
    });

    it('fails when no company matches, and when nothing is said', async () => {
        const none: Harness = harness(platformApi);
        expect(await run(none.context, ['use', 'zzz'])).toBe(2);
        expect(none.err()).toContain('Nenhuma empresa casa com "zzz"');
        expect(none.calls.some((call: Call) => call.method === 'PUT')).toBe(false);

        const unknownId: Harness = harness(platformApi);
        expect(await run(unknownId.context, ['use', '0192b2f0-0000-7000-8000-00000000ffff'])).toBe(2);
        expect(unknownId.err()).toContain('Nenhuma empresa com o id');
        expect(unknownId.calls.some((call: Call) => call.method === 'PUT')).toBe(false);

        const empty: Harness = harness(platformApi);
        expect(await run(empty.context, ['use'])).toBe(2);
        expect(empty.calls).toHaveLength(0);
    });

    it('goes back to no company with --none', async () => {
        const h: Harness = harness(platformApi);

        expect(await run(h.context, ['use', '--none'])).toBe(0);

        expect(h.calls).toEqual([{ method: 'DELETE', path: '/v1/platform/active-company', body: null }]);
        expect(h.out()).toContain('Nenhuma empresa escolhida');
    });
});

describe('nexo whoami on a platform connection', () => {
    it('shows the active company', async () => {
        const h: Harness = harness(() => json(200, meOf({ global: true, activeCompanyId: ACOPLAST })));

        expect(await run(h.context, ['whoami'])).toBe(0);

        expect(h.out()).toContain(`Conexão de plataforma, empresa ativa: Nexo (${ACOPLAST})`);
    });

    it('warns when no company is chosen', async () => {
        const h: Harness = harness(() => json(200, meOf({ global: true, activeCompanyId: null })));

        await run(h.context, ['whoami']);

        expect(h.out()).toContain('nenhuma empresa escolhida');
        expect(h.out()).toContain('nexo use <empresa>');
    });

    it('keeps the plain line on a normal connection', async () => {
        const h: Harness = harness(() => json(200, meOf(null)));

        await run(h.context, ['whoami']);

        expect(h.out()).toContain('Empresa: Nexo');
    });

    it('keeps working against an API without the platform field', async () => {
        const me: Record<string, unknown> = { ...(meOf(null) as Record<string, unknown>) };
        delete me['platform'];
        const h: Harness = harness(() => json(200, me));

        expect(await run(h.context, ['whoami'])).toBe(0);

        expect(h.out()).toContain('Empresa: Nexo');
    });
});

describe('the choose-a-company error', () => {
    it('points to nexo companies and nexo use on any command', async () => {
        const h: Harness = harness(() =>
            json(409, {
                type: 'public_api.platform_company_required',
                title: 'Escolha uma empresa',
                status: 409,
                detail: 'A conexão de plataforma ainda não escolheu a empresa.'
            })
        );

        expect(await run(h.context, ['api', 'deals'])).not.toBe(0);

        expect(h.err()).toContain('Escolha uma empresa');
        expect(h.err()).toContain('`nexo companies`');
        expect(h.err()).toContain('`nexo use <empresa>`');
    });
});

function featuresOf(capabilities: readonly unknown[]): unknown {
    return { company: { id: ACOPLAST, name: 'Acoplast', suspended: false }, capabilities };
}

const FORECAST_OFF: unknown = { capability: 'forecast', displayName: 'Previsão', allowed: false, source: 'none' };
const FORECAST_ON: unknown = { capability: 'forecast', displayName: 'Previsão', allowed: true, source: 'granted' };

function featuresApi(after: unknown, problem?: Response): (call: Call) => Response {
    return (call: Call): Response => {
        if (call.path.startsWith('/v1/platform/companies?') || call.path === '/v1/platform/companies') {
            return platformApi(call);
        }
        if (call.method === 'GET') {
            return json(200, featuresOf([FORECAST_OFF]));
        }
        return problem ?? json(200, featuresOf([after]));
    };
}

describe('nexo features', () => {
    it('lists the features of a company found by name, with where each came from', async () => {
        const h: Harness = harness(featuresApi(FORECAST_ON));

        expect(await run(h.context, ['features', 'list', 'acopl'])).toBe(0);

        expect(h.calls.at(-1)).toEqual({ method: 'GET', path: `/v1/platform/companies/${ACOPLAST}/capabilities`, body: null });
        expect(h.out()).toContain(`Acoplast (${ACOPLAST})`);
        expect(h.out()).toContain('[ ] forecast  Previsão  (fora do plano)');
    });

    it('frees a feature, and asks the required modules along with --with-required', async () => {
        const h: Harness = harness(featuresApi(FORECAST_ON));

        expect(await run(h.context, ['features', 'on', ACOPLAST, 'forecast'])).toBe(0);

        expect(h.calls.at(-1)).toMatchObject({ method: 'PUT', path: `/v1/platform/companies/${ACOPLAST}/capabilities/forecast` });
        expect(JSON.parse(h.calls.at(-1)?.body ?? '{}')).toEqual({ allowed: true });
        expect(h.out()).toContain('Liberada em Acoplast: [x] forecast  Previsão  (liberada à mão)');

        const together: Harness = harness(featuresApi(FORECAST_ON));
        expect(await run(together.context, ['features', 'on', ACOPLAST, 'forecast', '--with-required'])).toBe(0);
        expect(JSON.parse(together.calls.at(-1)?.body ?? '{}')).toEqual({ allowed: true, withRequired: true });
    });

    it('takes a feature away', async () => {
        const h: Harness = harness(featuresApi({ ...(FORECAST_OFF as object), source: 'revoked' }));

        expect(await run(h.context, ['features', 'off', ACOPLAST, 'forecast'])).toBe(0);

        expect(JSON.parse(h.calls.at(-1)?.body ?? '{}')).toEqual({ allowed: false });
        expect(h.out()).toContain('Tirada em Acoplast: [ ] forecast  Previsão  (tirada à mão)');
    });

    it('says how to go on when a required module is missing', async () => {
        const refused: Response = json(409, {
            type: 'plans.module_requires_missing',
            title: 'ModuleRequirementsMissingError',
            status: 409,
            detail: 'Para ligar Painéis no Nexo, ligue antes Registros. Se preferir, ligue os módulos juntos.',
            meta: { product: 'crm_dashboards' }
        });
        const h: Harness = harness(featuresApi(FORECAST_ON, refused));

        expect(await run(h.context, ['features', 'on', ACOPLAST, 'crm_dashboards'])).not.toBe(0);

        expect(h.err()).toContain('ligue antes Registros');
        expect(h.err()).toContain('--with-required');
    });
});
