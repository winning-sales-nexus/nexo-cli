import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { CredentialsStore } from '../src/config/credentials-store.js';
import type { CliContext } from '../src/context.js';
import { run } from '../src/run.js';

interface Served {
    readonly name: string;
    readonly kind: string;
    readonly title: string;
    readonly level: string;
    readonly body: string;
    readonly hidden?: boolean;
}

const SKILL: Served = {
    name: 'regra-da-empresa',
    kind: 'skill',
    title: 'regra-da-empresa',
    level: 'company',
    body: 'Procedimento da empresa.'
};
const UNIT: Served = {
    name: 'u-123',
    kind: 'preferencia',
    title: 'Tom de voz',
    level: 'company',
    body: 'CORPO SECRETO DA UNIDADE: fale sempre em tom informal.'
};
const NOTE: Served = { name: 'u-999', kind: 'nota_do_caso', title: 'Caso Acme', level: 'record', body: 'CORPO SECRETO DA NOTA.' };
const OUT_OF_INDEX: Served = {
    name: 'u-cut',
    kind: 'base',
    title: 'Base cortada',
    level: 'area',
    body: 'Fora do orçamento.',
    hidden: true
};

interface Harness {
    readonly context: CliContext;
    readonly out: () => string;
    readonly err: () => string;
    readonly project: string;
    readonly home: string;
    served: Served[];
}

function respond(body: unknown, status: number = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function harness(login: boolean = true): Harness {
    const project: string = mkdtempSync(join(tmpdir(), 'nexo-project-'));
    const home: string = mkdtempSync(join(tmpdir(), 'nexo-home-'));
    const stdout: PassThrough = new PassThrough();
    const stderr: PassThrough = new PassThrough();
    let out: string = '';
    let err: string = '';
    stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    stderr.on('data', (chunk: Buffer) => (err += chunk.toString()));
    const store: CredentialsStore = new CredentialsStore(mkdtempSync(join(tmpdir(), 'nexo-config-')));
    if (login) {
        store.save('default', { kind: 'pat', apiUrl: 'https://api.test', token: 'token', savedAt: '2026-11-19T00:00:00Z' });
    }
    const state: Harness = {
        project,
        home,
        served: [SKILL, UNIT, NOTE, OUT_OF_INDEX],
        out: () => out,
        err: () => err,
        context: undefined as unknown as CliContext
    };
    const viewOf = (item: Served): Record<string, string> => ({
        name: item.name,
        kind: item.kind,
        title: item.title,
        level: item.level,
        status: 'active',
        description: `Quando usar: ${item.title}`,
        version: 'v1'
    });
    const fetchFn = (input: string): Promise<Response> => {
        const path: string = new URL(input).pathname;
        if (path === '/docs/skills/index.json') {
            return Promise.resolve(respond({}, 404));
        }
        if (path === '/v1/skills') {
            return Promise.resolve(
                respond({ skills: state.served.filter((item: Served) => item.hidden !== true).map(viewOf), reachVersion: 'r' })
            );
        }
        const found: Served | undefined = state.served.find((item: Served) => path === `/v1/skills/${item.name}`);
        return Promise.resolve(
            found === undefined
                ? respond({ title: 'Skill não encontrada', status: 404 }, 404)
                : respond({ ...viewOf(found), body: found.body })
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

function parsed(text: string): never {
    return JSON.parse(text) as never;
}

function everythingUnder(directory: string): string {
    return filesUnder(directory)
        .map((path: string) => `${path}\n${readFileSync(path, 'utf8')}`)
        .join('\n');
}

describe('nexo skills list with units of context', () => {
    it('lists units and skills with kind, level and description, and --json brings the same fields', async () => {
        const h: Harness = harness();

        expect(await run(h.context, ['skills', 'list', '--dir', h.project])).toBe(0);

        expect(h.out()).toContain('u-123 [contexto: preferencia, empresa] Tom de voz');
        expect(h.out()).toContain('u-999 [contexto: nota_do_caso, registro] Caso Acme');
        expect(h.out()).toContain('regra-da-empresa [empresa]');

        const json: Harness = harness();
        await run(json.context, ['skills', 'list', '--json', '--dir', json.project]);
        const rows: { name: string; kind: string; title: string; level: string; description: string }[] = parsed(json.out());
        expect(rows.find((row) => row.name === 'u-123')).toMatchObject({
            kind: 'preferencia',
            title: 'Tom de voz',
            level: 'empresa',
            description: 'Quando usar: Tom de voz'
        });
        expect(rows.find((row) => row.name === 'regra-da-empresa')).toMatchObject({ kind: 'skill' });
    });
});

describe('nexo skills show with units of context', () => {
    it('opens a unit by the id of the index and writes nothing', async () => {
        const h: Harness = harness();

        expect(await run(h.context, ['skills', 'show', 'u-123'])).toBe(0);

        expect(h.out()).toContain('CORPO SECRETO DA UNIDADE');
        expect(filesUnder(h.home)).toEqual([]);
    });

    it('opens a unit the index cut for the budget of the channel, since the API decides what is reachable', async () => {
        const h: Harness = harness();

        await run(h.context, ['skills', 'show', 'u-cut']);

        expect(h.out()).toContain('Fora do orçamento.');
    });

    it('answers that a unit out of reach does not exist, as the API does', async () => {
        const h: Harness = harness();

        expect(await run(h.context, ['skills', 'show', 'u-alheia'])).not.toBe(0);

        expect(h.err()).toContain('Não achei');
        expect(h.out()).toBe('');
    });
});

describe('nexo skills install with units of context', () => {
    it('writes the index in the folder of the user of each tool, never in the project, and no body of a unit', async () => {
        const h: Harness = harness();
        mkdirSync(join(h.project, '.claude'));

        expect(await run(h.context, ['skills', 'install', '--dir', h.project])).toBe(0);

        const index: string = readFileSync(join(h.home, '.claude/skills/nexo-default-indice-do-cerebro/SKILL.md'), 'utf8');
        expect(index).toContain('`u-123` (preferencia, empresa): Tom de voz. Quando usar: Tom de voz');
        expect(index).toContain('`u-999` (nota_do_caso, registro)');
        expect(index).toContain('nexo skills show <id>');
        expect(everythingUnder(h.home)).not.toContain('CORPO SECRETO');
        expect(everythingUnder(h.project)).not.toContain('u-123');
        expect(everythingUnder(h.project)).not.toContain('CORPO SECRETO');
        expect(existsSync(join(h.home, '.claude/skills/nexo-default-u-123'))).toBe(false);
        expect(h.out()).toContain('índice');
    });

    it('updates the index at the next install, removing what left, and drops it when no unit is left', async () => {
        const h: Harness = harness();
        mkdirSync(join(h.project, '.claude'));
        await run(h.context, ['skills', 'install', '--dir', h.project]);
        h.served = [SKILL, NOTE];

        await run(h.context, ['skills', 'install', '--dir', h.project]);

        const index: string = readFileSync(join(h.home, '.claude/skills/nexo-default-indice-do-cerebro/SKILL.md'), 'utf8');
        expect(index).not.toContain('u-123');
        expect(index).toContain('u-999');

        h.served = [SKILL];
        await run(h.context, ['skills', 'install', '--dir', h.project]);

        expect(existsSync(join(h.home, '.claude/skills/nexo-default-indice-do-cerebro'))).toBe(false);
        expect(existsSync(join(h.home, '.claude/skills/nexo-default-regra-da-empresa'))).toBe(true);
    });

    it('does not count the index among the skills of the company, and logout removes it', async () => {
        const h: Harness = harness();
        mkdirSync(join(h.project, '.claude'));
        await run(h.context, ['skills', 'install', '--json', '--dir', h.project]);
        const result: { clientSkills: string[]; contextUnits: string[] } = parsed(h.out());

        expect(result.clientSkills).toEqual(['regra-da-empresa']);
        expect(result.contextUnits).toEqual(['u-123', 'u-999']);

        await run(h.context, ['logout']);

        expect(existsSync(join(h.home, '.claude/skills/nexo-default-indice-do-cerebro'))).toBe(false);
    });

    it('without a login installs only the skills of the package and warns', async () => {
        const h: Harness = harness(false);
        mkdirSync(join(h.project, '.claude'));

        expect(await run(h.context, ['skills', 'install', '--dir', h.project])).toBe(0);

        expect(existsSync(join(h.home, '.claude'))).toBe(false);
        expect(h.err()).toContain('Sem login');
        expect(existsSync(join(h.project, '.claude/skills/nexo-api/SKILL.md'))).toBe(true);
    });
});
