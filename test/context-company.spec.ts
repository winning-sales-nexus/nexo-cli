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

interface Call {
    readonly method: string;
    readonly path: string;
    readonly body: unknown;
}

interface Harness {
    readonly context: CliContext;
    readonly calls: Call[];
    readonly out: () => string;
    readonly err: () => string;
}

function harness(routes: Readonly<Record<string, { status?: number; body: unknown }>>): Harness {
    const calls: Call[] = [];
    const stdout: PassThrough = new PassThrough();
    const stderr: PassThrough = new PassThrough();
    let out: string = '';
    let err: string = '';
    stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    stderr.on('data', (chunk: Buffer) => (err += chunk.toString()));
    const fetchFn: FetchFunction = (url: string, init?: RequestInit) => {
        const path: string = url.replace(API, '');
        const method: string = init?.method ?? 'GET';
        calls.push({ method, path, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
        const route: { status?: number; body: unknown } = routes[`${method} ${path}`] ?? { status: 404, body: { title: 'Não encontrado' } };
        const status: number = route.status ?? 200;
        return Promise.resolve(
            new Response(status === 204 ? null : JSON.stringify(route.body), {
                status,
                headers: { 'content-type': 'application/json' }
            })
        );
    };
    const context: CliContext = {
        store: new CredentialsStore(mkdtempSync(join(tmpdir(), 'nexo-context-'))),
        env: { NEXO_TOKEN: `nexo_pat_${'d'.repeat(38)}` },
        stdin: Readable.from(['']),
        stdout,
        stderr,
        fetchFn,
        openUrl: () => Promise.resolve(false)
    };
    return { context, calls, out: () => out, err: () => err };
}

const CARD: Record<string, unknown> = {
    title: 'Mudar a oferta',
    details: ['Sai: Diagnóstico de 30 minutos', 'Entra: Diagnóstico de 60 minutos'],
    confirmation: { token: 'tok-1', expiresAt: '2026-11-28T12:00:00.000Z' }
};

const CONTEXT: Record<string, unknown> = {
    reading: null,
    canvases: {
        offer: {
            version: 3,
            state: 'confirmed',
            canvas: {
                offerings: [{ name: { value: 'Diagnóstico', origin: 'confirmed', candidates: [] } }]
            }
        }
    }
};

describe('nexo context', () => {
    it('reads one block with the origin of each field', async () => {
        const h: Harness = harness({ 'GET /v1/company/context': { body: CONTEXT } });

        const code: number = await run(h.context, ['context', 'oferta']);

        expect(code).toBe(0);
        expect(h.out()).toContain('oferta: confirmado, versão 3');
        expect(h.out()).toContain('offerings.0.name = Diagnóstico  [confirmed]');
    });

    it('previews, then applies the same request with the token after the yes', async () => {
        const h: Harness = harness({
            'POST /v1/company/context/changes/preview': { body: CARD },
            'POST /v1/company/context/changes/apply': { body: { message: 'O contexto da empresa foi mudado.' } }
        });

        const code: number = await run(h.context, [
            'contexto',
            'set',
            'oferta',
            'offerings.0.whatItIs',
            'Diagnóstico de 60 minutos',
            '--change-confirmed',
            '--yes'
        ]);

        const request: Record<string, unknown> = {
            bloco: 'oferta',
            acao: 'campo_mudar',
            campo: 'offerings.0.whatItIs',
            valor: 'Diagnóstico de 60 minutos',
            confirmaBlocoConfirmado: true
        };
        expect(code).toBe(0);
        expect(h.calls.map((call: Call) => call.path)).toEqual([
            '/v1/company/context/changes/preview',
            '/v1/company/context/changes/apply'
        ]);
        expect(h.calls[0]?.body).toEqual(request);
        expect(h.calls[1]?.body).toEqual({ ...request, confirmationToken: 'tok-1' });
        expect(h.out()).toContain('Entra: Diagnóstico de 60 minutos');
    });

    it('does not write outside a terminal without the yes, and does not ask to change a confirmed block by itself', async () => {
        const h: Harness = harness({ 'POST /v1/company/context/changes/preview': { body: CARD } });

        const code: number = await run(h.context, ['context', 'add', 'oferta', 'offerings', '{"name":"Curso"}', '--value-json']);

        expect(code).toBe(0);
        expect(h.calls).toHaveLength(1);
        expect(h.calls[0]?.body).toEqual({ bloco: 'oferta', acao: 'item_somar', campo: 'offerings', valor: { name: 'Curso' } });
        expect(h.err()).toContain('--yes');
    });

    it('removes by position or by text and confirms a draft block', async () => {
        const h: Harness = harness({
            'POST /v1/company/context/changes/preview': { body: CARD },
            'POST /v1/company/context/changes/apply': { body: { message: 'ok' } }
        });

        await run(h.context, ['context', 'remove', 'persona', 'personas.0.painPoints', '2', '-y']);
        await run(h.context, ['context', 'confirm', 'proposta-de-valor', '-y']);

        expect(h.calls[0]?.body).toEqual({ bloco: 'persona', acao: 'item_tirar', campo: 'personas.0.painPoints', item: 2 });
        expect(h.calls[2]?.body).toEqual({ bloco: 'proposta_de_valor', acao: 'bloco_confirmar' });
    });

    it('refuses an unknown block before calling the Nexo', async () => {
        const h: Harness = harness({});

        expect(await run(h.context, ['context', 'set', 'vendas', 'x', 'y'])).not.toBe(0);
        expect(h.calls).toEqual([]);
    });
});
