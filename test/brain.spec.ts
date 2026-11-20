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
const AREA: string = '0192b2f0-0000-7000-8000-0000000000a1';

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
        store: new CredentialsStore(mkdtempSync(join(tmpdir(), 'nexo-brain-'))),
        env: { NEXO_TOKEN: `nexo_pat_${'d'.repeat(38)}` },
        stdin: Readable.from(['']),
        stdout,
        stderr,
        fetchFn,
        openUrl: () => Promise.resolve(false)
    };
    return { context, calls, out: () => out, err: () => err };
}

const SKILL: Record<string, unknown> = {
    id: ID,
    name: 'area-vendas-follow-up',
    description: 'Quando escrever o follow-up',
    status: 'tentative',
    version: 1
};

describe('nexo brain', () => {
    it('creates an area skill from the idea and never sends a name, a description or a body', async () => {
        const h: Harness = harness({ 'POST /v1/brain/area-skills': { status: 201, body: SKILL } });

        const code: number = await run(h.context, [
            'brain',
            'create',
            'area',
            '--area',
            AREA,
            '--objective',
            'Follow-up curto',
            '--moment',
            'follow_up_draft',
            '--always',
            'citar o último passo',
            '--always',
            'propor data',
            '--never',
            'prometer desconto',
            '--example',
            'Oi, Ana'
        ]);

        expect(code).toBe(0);
        expect(h.calls[0]?.body).toEqual({
            areaId: AREA,
            objective: 'Follow-up curto',
            moment: 'follow_up_draft',
            always: ['citar o último passo', 'propor data'],
            never: ['prometer desconto'],
            example: 'Oi, Ana'
        });
        expect(h.out()).toContain('nasce em teste');
    });

    it('creates a company skill with no place field and refuses an idea with no item', async () => {
        const h: Harness = harness({ 'POST /v1/brain/company-skills': { status: 201, body: SKILL } });
        const base: string[] = ['brain', 'create', 'company', '--objective', 'x', '--moment', 'follow_up_draft', '--example', 'y'];

        expect(await run(h.context, base)).not.toBe(0);
        expect(h.calls).toEqual([]);
        expect(await run(h.context, [...base, '--never', 'inventar'])).toBe(0);
        expect(h.calls[0]?.body).toMatchObject({ never: ['inventar'], always: [] });
        expect(h.calls[0]?.body).not.toHaveProperty('areaId');
    });

    it('edits by item and sends confirmShrink only when asked', async () => {
        const h: Harness = harness({ [`PUT /v1/brain/team-skills/${ID}`]: { body: { ...SKILL, version: 2 } } });

        const code: number = await run(h.context, [
            'brain',
            'edit',
            'team',
            ID,
            '--add-always',
            'novo',
            '--update-never',
            'velho => novo',
            '--remove-always',
            'tirar',
            '--confirm-shrink'
        ]);

        expect(code).toBe(0);
        expect(h.calls[0]?.body).toEqual({
            changes: [
                { op: 'add', list: 'sempre', item: 'novo' },
                { op: 'update', list: 'nunca', item: 'velho', to: 'novo' },
                { op: 'remove', list: 'sempre', item: 'tirar' }
            ],
            confirmShrink: true
        });
        expect(h.out()).toContain('versão 2');
    });

    it('shows the shrink confirmation as a readable message', async () => {
        const h: Harness = harness({
            [`PUT /v1/brain/company-skills/${ID}`]: {
                status: 409,
                body: {
                    type: 'brain.skill_shrink_needs_confirmation',
                    title: 'Conflito',
                    detail: 'A edição encolhe a skill em 40%',
                    status: 409
                }
            }
        });

        const code: number = await run(h.context, ['brain', 'edit', 'company', ID, '--remove-never', 'x']);

        expect(code).not.toBe(0);
        expect(h.err()).toContain('encolhe a skill em 40%');
        expect(h.err()).toContain('--confirm-shrink');
    });

    it('rejects an update with no arrow and an edit with no change', async () => {
        const h: Harness = harness({});

        expect(await run(h.context, ['brain', 'edit', 'area', ID, '--update-always', 'sem seta'])).not.toBe(0);
        expect(await run(h.context, ['brain', 'edit', 'area', ID])).not.toBe(0);
        expect(h.calls).toEqual([]);
    });

    it('has no option that sends a name, a description or a body', async () => {
        const h: Harness = harness({});

        for (const flag of ['--name', '--description', '--body']) {
            expect(await run(h.context, ['brain', 'create', 'company', flag, 'x'])).not.toBe(0);
        }
        expect(h.calls).toEqual([]);
    });

    it('lists the moments offered, the areas and the skills of a level', async () => {
        const h: Harness = harness({
            'GET /v1/brain/area-skills': { body: { skills: [SKILL] } },
            'GET /v1/brain/skills/moments': { body: { moments: ['follow_up_draft'] } },
            'GET /v1/brain/areas': { body: { areas: [{ id: AREA, name: 'Vendas' }] } }
        });

        expect(await run(h.context, ['brain', 'moments'])).toBe(0);
        expect(await run(h.context, ['brain', 'areas'])).toBe(0);
        expect(await run(h.context, ['brain', 'list', 'area'])).toBe(0);

        expect(h.out()).toContain('follow_up_draft');
        expect(h.out()).toContain('Vendas');
        expect(h.out()).toContain('area-vendas-follow-up');
    });

    it('removes a team skill only with --yes', async () => {
        const h: Harness = harness({ [`DELETE /v1/brain/team-skills/${ID}`]: { status: 204, body: null } });

        expect(await run(h.context, ['brain', 'remove', 'team', ID])).toBe(0);
        expect(h.calls).toEqual([]);
        expect(await run(h.context, ['brain', 'remove', 'team', ID, '--yes'])).toBe(0);
        expect(h.calls[0]?.method).toBe('DELETE');
    });
    it('lists and deletes company skills now that the API has the routes', async () => {
        const h: Harness = harness({
            'GET /v1/brain/company-skills': { body: { skills: [SKILL] } },
            [`DELETE /v1/brain/company-skills/${ID}`]: { status: 204, body: null }
        });

        expect(await run(h.context, ['brain', 'list', 'company'])).toBe(0);
        expect(h.out()).toContain('area-vendas-follow-up');
        expect(await run(h.context, ['brain', 'remove', 'company', ID, '--yes'])).toBe(0);
        expect(h.calls[1]?.method).toBe('DELETE');
    });

    it('creates, edits, lists and deletes a personal skill', async () => {
        const h: Harness = harness({
            'POST /v1/brain/person-skills': { status: 201, body: SKILL },
            [`PUT /v1/brain/person-skills/${ID}`]: { body: { ...SKILL, version: 2 } },
            'GET /v1/brain/person-skills': { body: { skills: [SKILL], maxSkills: 10, maxIndexChars: 100, indexChars: 5 } },
            [`DELETE /v1/brain/person-skills/${ID}`]: { status: 204, body: null }
        });

        expect(
            await run(h.context, [
                'brain',
                'create',
                'person',
                '--objective',
                'x',
                '--moment',
                'follow_up_draft',
                '--always',
                'a',
                '--example',
                'y'
            ])
        ).toBe(0);
        expect(h.calls[0]?.body).toEqual({ objective: 'x', moment: 'follow_up_draft', always: ['a'], never: [], example: 'y' });
        expect(await run(h.context, ['brain', 'edit', 'person', ID, '--add-never', 'z'])).toBe(0);
        expect(await run(h.context, ['brain', 'list', 'person'])).toBe(0);
        expect(h.out()).toContain('1 de 10 skills pessoais');
        expect(await run(h.context, ['brain', 'remove', 'person', ID, '--yes'])).toBe(0);
        expect(h.out()).toContain('30 dias');
    });

    it('lists the templates and creates a personal skill from one with the answers', async () => {
        const h: Harness = harness({
            'GET /v1/brain/person-skills/templates': {
                body: {
                    templates: [
                        {
                            id: 'tpl-1',
                            title: 'Follow-up',
                            moment: 'follow_up_draft',
                            available: true,
                            fields: [{ key: 'tom', label: 'Tom' }],
                            cases: []
                        }
                    ]
                }
            },
            'POST /v1/brain/person-skills/from-template': { status: 201, body: SKILL }
        });

        expect(await run(h.context, ['brain', 'templates'])).toBe(0);
        expect(h.out()).toContain('tpl-1');
        expect(await run(h.context, ['brain', 'from-template', 'tpl-1'])).not.toBe(0);
        expect(await run(h.context, ['brain', 'from-template', 'tpl-1', '--answer', 'tom=direto'])).toBe(0);
        expect(h.calls[1]?.body).toEqual({ templateId: 'tpl-1', answers: { tom: 'direto' } });
    });

    it('opens the blind test and sends the choice', async () => {
        const choice: string = '0192b2f0-0000-7000-8000-0000000000c1';
        const h: Harness = harness({
            [`POST /v1/brain/person-skills/${ID}/blind-test`]: {
                body: { id: choice, skillId: ID, scenario: 'Cenário', a: 'texto A', b: 'texto B' }
            },
            [`POST /v1/brain/person-skills/blind-tests/${choice}/choose`]: {
                body: { id: choice, chosen: 'a', withSkillAt: 'b', withSkillChosen: false, activated: false, next: 'ask_what_was_missing' }
            }
        });

        expect(await run(h.context, ['brain', 'blind-test', ID])).toBe(0);
        expect(h.out()).toContain('texto A');
        expect(await run(h.context, ['brain', 'choose', choice, 'x'])).not.toBe(0);
        expect(await run(h.context, ['brain', 'choose', choice, 'A'])).toBe(0);
        expect(h.calls[1]?.body).toEqual({ chosen: 'a' });
        expect(h.out()).toContain('desligada');
    });

    it('reads the moments from the skills/moments route', async () => {
        const h: Harness = harness({ 'GET /v1/brain/skills/moments': { body: { moments: ['follow_up_draft'] } } });

        expect(await run(h.context, ['brain', 'moments'])).toBe(0);
        expect(h.out()).toContain('follow_up_draft');
    });
});
