import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { CredentialsStore } from '../src/config/credentials-store.js';
import type { CliContext } from '../src/context.js';
import { run } from '../src/run.js';

interface Served {
    readonly name: string;
    readonly level: string;
    readonly status?: string;
    readonly body: string;
}

const COMPANY_SKILL: Served = { name: 'regra-da-empresa', level: 'company', body: 'Procedimento secreto da empresa.' };
const TEAM_SKILL: Served = { name: 'time-meu', level: 'team', body: 'Procedimento do time.' };
const TEST_SKILL: Served = { name: 'time-novo', level: 'team', status: 'tentative', body: 'Ainda em teste.' };

interface Harness {
    readonly context: CliContext;
    readonly out: () => string;
    readonly err: () => string;
    readonly project: string;
    readonly home: string;
    readonly calls: string[];
    served: Served[];
}

function respond(body: unknown): Response {
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function harness(options: { readonly login?: boolean; readonly offline?: boolean } = {}): Harness {
    const project: string = mkdtempSync(join(tmpdir(), 'nexo-project-'));
    const home: string = mkdtempSync(join(tmpdir(), 'nexo-home-'));
    const stdout: PassThrough = new PassThrough();
    const stderr: PassThrough = new PassThrough();
    let out: string = '';
    let err: string = '';
    stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    stderr.on('data', (chunk: Buffer) => (err += chunk.toString()));
    const store: CredentialsStore = new CredentialsStore(mkdtempSync(join(tmpdir(), 'nexo-config-')));
    if (options.login !== false) {
        store.save('default', { kind: 'pat', apiUrl: 'https://api.test', token: 'token', savedAt: '2026-11-19T00:00:00Z' });
        store.save('outra', { kind: 'pat', apiUrl: 'https://api.test', token: 'token-outra', savedAt: '2026-11-19T00:00:00Z' });
    }
    const state: Harness = {
        project,
        home,
        calls: [],
        served: [COMPANY_SKILL, TEAM_SKILL],
        out: () => out,
        err: () => err,
        context: undefined as unknown as CliContext
    };
    const fetchFn = (input: string): Promise<Response> => {
        if (options.offline === true) {
            return Promise.reject(new Error('sem rede'));
        }
        const path: string = new URL(input).pathname;
        state.calls.push(path);
        if (path === '/v1/skills') {
            return Promise.resolve(
                respond({
                    skills: state.served.map((skill: Served) => ({
                        name: skill.name,
                        level: skill.level,
                        status: skill.status ?? 'active',
                        description: `Quando usar: ${skill.name}`,
                        version: 'v1'
                    })),
                    reachVersion: 'r'
                })
            );
        }
        const found: Served | undefined = state.served.find((skill: Served) => path === `/v1/skills/${skill.name}`);
        return Promise.resolve(
            found === undefined
                ? new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } })
                : respond({
                      name: found.name,
                      level: found.level,
                      status: found.status ?? 'active',
                      description: 'd',
                      version: 'v1',
                      body: found.body
                  })
        );
    };
    return Object.assign(state, {
        context: {
            store,
            env: { HOME: home },
            stdin: Readable.from(['']),
            stdout,
            stderr,
            fetchFn,
            openUrl: () => Promise.resolve(false)
        } satisfies CliContext
    });
}

function filesUnder(directory: string): string[] {
    if (!existsSync(directory)) {
        return [];
    }
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? filesUnder(join(directory, entry.name)) : [join(directory, entry.name)]
    );
}

function foldersIn(directory: string): string[] {
    return existsSync(directory)
        ? readdirSync(directory)
              .filter((name: string) => statSync(join(directory, name)).isDirectory())
              .sort()
        : [];
}

describe('nexo skills install with a login', () => {
    it('writes the skills of the company, area and team in the folder of the user and nothing of them in the project', async () => {
        const h: Harness = harness();
        mkdirSync(join(h.project, '.claude'));

        expect(await run(h.context, ['skills', 'install', '--dir', h.project])).toBe(0);

        expect(foldersIn(join(h.home, '.claude/skills'))).toEqual(['nexo-default-regra-da-empresa', 'nexo-default-time-meu']);
        const file: string = readFileSync(join(h.home, '.claude/skills/nexo-default-regra-da-empresa/SKILL.md'), 'utf8');
        expect(file).toContain('name: nexo-default-regra-da-empresa');
        expect(file).toContain('Procedimento secreto da empresa.');
        const inProject: string = filesUnder(h.project)
            .map((path: string) => `${path}\n${readFileSync(path, 'utf8')}`)
            .join('\n');
        expect(inProject).not.toContain('Procedimento secreto da empresa.');
        expect(inProject).not.toContain('regra-da-empresa');
        expect(foldersIn(join(h.project, '.claude/skills'))).toEqual(['nexo-api', 'nexo-automations', 'nexo-connect', 'nexo-dashboards']);
    });

    it('writes in Codex and Claude Code folders by the tool, and each skill once in Cursor', async () => {
        const codex: Harness = harness();
        await run(codex.context, ['skills', 'install', '--agents', '--dir', codex.project]);
        expect(foldersIn(join(codex.home, '.codex/skills'))).toHaveLength(2);
        expect(foldersIn(join(codex.home, '.claude/skills'))).toEqual([]);

        const both: Harness = harness();
        mkdirSync(join(both.home, '.claude'));
        await run(both.context, ['skills', 'install', '--cursor', '--claude', '--dir', both.project]);
        expect(foldersIn(join(both.home, '.claude/skills'))).toHaveLength(2);
        expect(foldersIn(join(both.home, '.cursor/skills'))).toEqual([]);

        const cursor: Harness = harness();
        await run(cursor.context, ['skills', 'install', '--cursor', '--dir', cursor.project]);
        expect(foldersIn(join(cursor.home, '.cursor/skills'))).toHaveLength(2);
    });

    it('keeps two profiles apart and logout clears only the profile that leaves', async () => {
        const h: Harness = harness();
        mkdirSync(join(h.project, '.claude'));
        await run(h.context, ['skills', 'install', '--dir', h.project]);
        h.served = [{ name: 'regra-da-outra', level: 'company', body: 'Outra empresa.' }];
        await run(h.context, ['skills', 'install', '--dir', h.project, '--profile', 'outra']);

        expect(foldersIn(join(h.home, '.claude/skills'))).toEqual([
            'nexo-default-regra-da-empresa',
            'nexo-default-time-meu',
            'nexo-outra-regra-da-outra'
        ]);

        await run(h.context, ['logout', '--profile', 'default']);

        expect(foldersIn(join(h.home, '.claude/skills'))).toEqual(['nexo-outra-regra-da-outra']);
        expect(foldersIn(join(h.project, '.claude/skills'))).toContain('nexo-api');
    });

    it('drops, at the next install, a skill the person no longer reaches', async () => {
        const h: Harness = harness();
        mkdirSync(join(h.project, '.claude'));
        await run(h.context, ['skills', 'install', '--dir', h.project]);
        h.served = [COMPANY_SKILL];

        await run(h.context, ['skills', 'install', '--dir', h.project]);

        expect(foldersIn(join(h.home, '.claude/skills'))).toEqual(['nexo-default-regra-da-empresa']);
    });

    it('marks a skill in test in the name of the folder', async () => {
        const h: Harness = harness();
        h.served = [TEST_SKILL];
        mkdirSync(join(h.project, '.claude'));

        await run(h.context, ['skills', 'install', '--dir', h.project]);

        expect(foldersIn(join(h.home, '.claude/skills'))).toEqual(['nexo-default-em-teste-time-novo']);
        expect(readFileSync(join(h.home, '.claude/skills/nexo-default-em-teste-time-novo/SKILL.md'), 'utf8')).toContain('em teste');
    });
});

describe('nexo skills without a login or without network', () => {
    it('installs only the product skills offline and says why', async () => {
        const h: Harness = harness({ login: false });
        mkdirSync(join(h.project, '.claude'));

        expect(await run(h.context, ['skills', 'install', '--dir', h.project])).toBe(0);

        expect(foldersIn(join(h.project, '.claude/skills'))).toHaveLength(4);
        expect(existsSync(join(h.home, '.claude'))).toBe(false);
        expect(h.err()).toContain('Sem login');
        expect(h.calls).toEqual([]);
    });

    it('keeps the product skills and what was already in the folder when the network fails', async () => {
        const ok: Harness = harness();
        mkdirSync(join(ok.project, '.claude'));
        await run(ok.context, ['skills', 'install', '--dir', ok.project]);
        const offline: Harness = harness({ offline: true });
        mkdirSync(join(offline.project, '.claude'));

        expect(await run(offline.context, ['skills', 'install', '--dir', offline.project])).toBe(0);

        expect(foldersIn(join(offline.project, '.claude/skills'))).toHaveLength(4);
        expect(offline.err()).toContain('Não consegui ler as skills da empresa');
    });
});

describe('nexo skills list and show', () => {
    it('lists the level of each skill', async () => {
        const h: Harness = harness();

        await run(h.context, ['skills', 'list', '--dir', h.project]);

        expect(h.out()).toContain('nexo-api [produto]');
        expect(h.out()).toContain('regra-da-empresa [empresa]');
        expect(h.out()).toContain('time-meu [time]');
    });

    it('lists only the product skills with no login, and says why', async () => {
        const h: Harness = harness({ login: false });

        await run(h.context, ['skills', 'list', '--dir', h.project]);

        expect(h.out()).toContain('nexo-api [produto]');
        expect(h.out()).not.toContain('[empresa]');
        expect(h.err()).toContain('Sem login');
    });

    it('shows a skill of the company with the token at the time of use and writes nothing', async () => {
        const h: Harness = harness();

        expect(await run(h.context, ['skills', 'show', 'regra-da-empresa'])).toBe(0);

        expect(h.out()).toContain('Procedimento secreto da empresa.');
        expect(filesUnder(h.project)).toEqual([]);
        expect(filesUnder(h.home)).toEqual([]);
    });

    it('shows a product skill from the package, offline', async () => {
        const h: Harness = harness({ login: false });

        expect(await run(h.context, ['skills', 'show', 'nexo-api'])).toBe(0);

        expect(h.out()).toContain('name: nexo-api');
    });
});
