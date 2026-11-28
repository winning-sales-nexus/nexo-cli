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
const ID: string = '0192b2f0-0000-7000-8000-0000000000b1';
const ID2: string = '0192b2f0-0000-7000-8000-0000000000b2';
const THEME: string = '0192b2f0-0000-7000-8000-0000000000c1';

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
        store: new CredentialsStore(mkdtempSync(join(tmpdir(), 'nexo-knowledge-'))),
        env: { NEXO_TOKEN: `nexo_pat_${'d'.repeat(38)}` },
        stdin: Readable.from(['']),
        stdout,
        stderr,
        fetchFn,
        openUrl: () => Promise.resolve(false)
    };
    return { context, calls, out: () => out, err: () => err };
}

const ITEM: Record<string, unknown> = {
    id: ID,
    type: 'rule',
    text: 'Licença anual',
    status: 'in_use',
    themeId: THEME,
    theme: { id: THEME, name: 'Nexo: licença e contrato' }
};

describe('nexo knowledge', () => {
    it('moves many items to a theme in one call', async () => {
        const h: Harness = harness({ 'POST /v1/knowledge/items/move': { body: { themeId: THEME, moved: 2, items: [] } } });

        const code: number = await run(h.context, ['knowledge', 'items', 'move', '--theme', THEME, ID, ID2]);

        expect(code).toBe(0);
        expect(h.calls[0]?.body).toEqual({ itemIds: [ID, ID2], themeId: THEME });
        expect(h.out()).toContain('2 item(ns)');
    });

    it('refuses a move without a theme before calling the API', async () => {
        const h: Harness = harness({});

        expect(await run(h.context, ['knowledge', 'items', 'move', ID])).not.toBe(0);
        expect(h.calls).toEqual([]);
    });

    it('edits type and theme and refuses an unknown type or an empty edit', async () => {
        const h: Harness = harness({ [`PATCH /v1/knowledge/items/${ID}`]: { body: ITEM } });

        expect(await run(h.context, ['knowledge', 'items', 'edit', ID, '--type', 'practice', '--theme', THEME])).toBe(0);
        expect(h.calls[0]?.body).toEqual({ type: 'practice', themeId: THEME });
        expect(await run(h.context, ['knowledge', 'items', 'edit', ID, '--type', 'nope'])).not.toBe(0);
        expect(await run(h.context, ['knowledge', 'items', 'edit', ID])).not.toBe(0);
        expect(h.calls).toHaveLength(1);
    });

    it('creates an item in a theme', async () => {
        const h: Harness = harness({ 'POST /v1/knowledge/items': { status: 201, body: ITEM } });

        const code: number = await run(h.context, ['knowledge', 'items', 'create', '--type', 'price', '--text', 'R$ 10', '--theme', THEME]);

        expect(code).toBe(0);
        expect(h.calls[0]?.body).toEqual({ type: 'price', text: 'R$ 10', themeId: THEME });
    });

    it('lists the items with their theme', async () => {
        const h: Harness = harness({
            'GET /v1/knowledge/items?type=rule': { body: { data: [ITEM], pagination: { page: 1, totalPages: 1, totalRecords: 1 } } }
        });

        expect(await run(h.context, ['knowledge', 'items', 'list', '--type', 'rule'])).toBe(0);
        expect(h.out()).toContain('Nexo: licença e contrato');
    });

    it('lists, creates, renames and removes themes', async () => {
        const theme: Record<string, unknown> = { id: THEME, name: 'Preços', itemCount: 3, materialCount: 1, webSourceCount: 0 };
        const h: Harness = harness({
            'GET /v1/knowledge/themes': { body: { data: [theme] } },
            'POST /v1/knowledge/themes': { status: 201, body: theme },
            [`PATCH /v1/knowledge/themes/${THEME}`]: { body: theme },
            [`DELETE /v1/knowledge/themes/${THEME}`]: { status: 204, body: null }
        });

        expect(await run(h.context, ['knowledge', 'themes', 'list'])).toBe(0);
        expect(h.out()).toContain('3 itens');
        expect(await run(h.context, ['knowledge', 'themes', 'create', 'Preços'])).toBe(0);
        expect(h.calls[1]?.body).toEqual({ name: 'Preços' });
        expect(await run(h.context, ['knowledge', 'themes', 'rename', THEME, 'Preços'])).toBe(0);
        expect(await run(h.context, ['knowledge', 'themes', 'remove', THEME, '--yes'])).toBe(0);
        expect(h.calls.map((call: Call) => call.method)).toEqual(['GET', 'POST', 'PATCH', 'DELETE']);
    });

    it('shows the API refusal of a theme with content', async () => {
        const h: Harness = harness({
            [`DELETE /v1/knowledge/themes/${THEME}`]: {
                status: 409,
                body: { title: 'O tema ainda tem conteúdo', code: 'knowledge.theme_not_empty' }
            }
        });

        expect(await run(h.context, ['knowledge', 'themes', 'remove', THEME, '--yes'])).not.toBe(0);
        expect(h.err()).toContain('O tema ainda tem conteúdo');
    });

    it('sends the rule fields on create and edit, with nulls for what is not given', async () => {
        const h: Harness = harness({
            'POST /v1/knowledge/items': { status: 201, body: ITEM },
            [`PATCH /v1/knowledge/items/${ID}`]: { body: ITEM }
        });

        const create: string[] = [
            'knowledge',
            'items',
            'create',
            '--type',
            'rule',
            '--text',
            'Desconto',
            '--subject',
            'discount',
            '--limit',
            '10%'
        ];
        expect(await run(h.context, create)).toBe(0);
        expect(h.calls[0]?.body).toEqual({
            type: 'rule',
            text: 'Desconto',
            rule: { subject: 'discount', condition: null, limit: '10%', exception: null, approver: null }
        });
        expect(
            await run(h.context, ['knowledge', 'items', 'edit', ID, '--type', 'rule', '--subject', 'deadline', '--approver', 'Ana'])
        ).toBe(0);
        expect(h.calls[1]?.body).toEqual({
            type: 'rule',
            rule: { subject: 'deadline', condition: null, limit: null, exception: null, approver: 'Ana' }
        });
        expect(await run(h.context, ['knowledge', 'items', 'create', '--type', 'rule', '--text', 'x'])).not.toBe(0);
        expect(h.calls).toHaveLength(2);
    });

    it('filters the list by theme on the client, walking every page', async () => {
        const other: Record<string, unknown> = { ...ITEM, id: ID2, themeId: ID, theme: { id: ID, name: 'Outro' } };
        const h: Harness = harness({
            'GET /v1/knowledge/items?page=1&pageSize=100': {
                body: { data: [ITEM], pagination: { page: 1, totalPages: 2, totalRecords: 2 } }
            },
            'GET /v1/knowledge/items?page=2&pageSize=100': {
                body: { data: [other], pagination: { page: 2, totalPages: 2, totalRecords: 2 } }
            }
        });

        expect(await run(h.context, ['knowledge', 'items', 'list', '--theme', THEME, '--json'])).toBe(0);
        expect(h.calls).toHaveLength(2);
        expect(JSON.parse(h.out())).toMatchObject({ data: [{ id: ID }] });
    });

    it('turns an item on and off, resolves a pending one and removes one', async () => {
        const h: Harness = harness({
            [`POST /v1/knowledge/items/${ID}/enable`]: { body: ITEM },
            [`POST /v1/knowledge/items/${ID}/disable`]: { body: ITEM },
            [`POST /v1/knowledge/items/${ID}/resolve`]: { body: ITEM },
            [`DELETE /v1/knowledge/items/${ID}`]: { status: 204, body: null }
        });

        expect(await run(h.context, ['knowledge', 'items', 'on', ID])).toBe(0);
        expect(await run(h.context, ['knowledge', 'items', 'off', ID])).toBe(0);
        expect(await run(h.context, ['knowledge', 'items', 'resolve', ID, '--action', 'rewrite', '--text', 'Novo'])).toBe(0);
        expect(h.calls[2]?.body).toEqual({ action: 'rewrite', text: 'Novo' });
        expect(await run(h.context, ['knowledge', 'items', 'remove', ID, '--yes'])).toBe(0);
        expect(h.calls.map((call: Call) => `${call.method} ${call.path.split(ID)[1] ?? ''}`)).toEqual([
            'POST /enable',
            'POST /disable',
            'POST /resolve',
            'DELETE '
        ]);
    });

    it('refuses a bad resolve before calling the API and does not remove without the yes', async () => {
        const h: Harness = harness({});

        expect(await run(h.context, ['knowledge', 'items', 'resolve', ID, '--action', 'rewrite'])).not.toBe(0);
        expect(await run(h.context, ['knowledge', 'items', 'resolve', ID, '--action', 'nope'])).not.toBe(0);
        await run(h.context, ['knowledge', 'items', 'remove', ID]);
        await run(h.context, ['knowledge', 'items', 'resolve', ID, '--action', 'discard']);
        expect(h.calls).toEqual([]);
    });
});
