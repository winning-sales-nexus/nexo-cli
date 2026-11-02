import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { CredentialsStore } from '../src/config/credentials-store.js';
import type { CliContext } from '../src/context.js';
import { splitPages } from '../src/docs/pages.js';
import type { DocPage } from '../src/docs/pages.js';
import { pageNamed, searchPages } from '../src/docs/search.js';
import { run } from '../src/run.js';
import { BLOCK_END, BLOCK_START, withAgentsBlock } from '../src/skills/targets.js';
import { bundledSkills } from '../src/skills/skill-files.js';

const FULL: string = [
    '<SYSTEM>docs</SYSTEM>',
    '',
    '# Início rápido',
    '',
    '> Crie um token e faça a primeira chamada.',
    '',
    'Texto do início.',
    '',
    '```sh',
    '# Isto é comentário de shell, não página',
    '',
    '> nem isto',
    '```',
    '',
    '# Referência do manifesto',
    '',
    '> Cada campo do manifesto.',
    '',
    '[Seção intitulada “Hosts”](#hosts)',
    'O campo hosts lista os hosts. hosts aprovados.'
].join('\n');

interface Harness {
    readonly context: CliContext;
    readonly out: () => string;
    readonly directory: string;
}

function harness(): Harness {
    const directory: string = mkdtempSync(join(tmpdir(), 'nexo-project-'));
    const stdout: PassThrough = new PassThrough();
    let out: string = '';
    stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    const context: CliContext = {
        store: new CredentialsStore(mkdtempSync(join(tmpdir(), 'nexo-config-'))),
        env: {},
        stdin: Readable.from(['']),
        stdout,
        stderr: new PassThrough(),
        fetchFn: () => Promise.reject(new Error('offline'))
    };
    return { context, out: () => out, directory };
}

describe('docs pages', () => {
    it('splits the full text into pages, ignoring headings inside code and section anchors', () => {
        const pages: readonly DocPage[] = splitPages(FULL);

        expect(pages.map((page) => page.slug)).toEqual(['inicio-rapido', 'referencia-do-manifesto']);
        expect(pages[0]?.body).toContain('comentário de shell');
        expect(pages[1]?.body).not.toContain('Seção intitulada');
    });

    it('ranks by title and body, needs every term, and finds a page by slug or a unique part of the title', () => {
        const pages: readonly DocPage[] = splitPages(FULL);

        expect(searchPages(pages, 'manifesto hosts', 5).map((hit) => hit.page.slug)).toEqual(['referencia-do-manifesto']);
        expect(searchPages(pages, 'token inexistente', 5)).toEqual([]);
        expect(pageNamed(pages, 'inicio-rapido')?.title).toBe('Início rápido');
        expect(pageNamed(pages, 'manifesto')?.slug).toBe('referencia-do-manifesto');
        expect(pageNamed(pages, 'r')).toBeNull();
    });

    it('ships enough embedded pages to answer offline', async () => {
        const h: Harness = harness();

        const code: number = await run(h.context, ['docs', 'search', 'connectors:hosts', '--json']);

        expect(code).toBe(0);
        expect((JSON.parse(h.out()) as unknown[]).length).toBeGreaterThan(0);
    });
});

describe('skills install', () => {
    it('ships the three product skills with name and description', () => {
        expect(bundledSkills().map((skill) => skill.name)).toEqual(['nexo-api', 'nexo-connect', 'nexo-dashboards']);
        expect(bundledSkills().every((skill) => skill.description.length > 40)).toBe(true);
    });

    it('detects Claude Code and writes the skills there', async () => {
        const h: Harness = harness();
        mkdirSync(join(h.directory, '.claude'));

        const code: number = await run(h.context, ['skills', 'install', '--dir', h.directory]);

        expect(code).toBe(0);
        expect(readFileSync(join(h.directory, '.claude/skills/nexo-connect/SKILL.md'), 'utf8')).toContain('name: nexo-connect');
    });

    it('asks which client when the project has none', async () => {
        const h: Harness = harness();

        expect(await run(h.context, ['skills', 'install', '--dir', h.directory])).toBe(2);
    });

    it('writes Cursor rules with the description and keeps the rest of AGENTS.md', async () => {
        const h: Harness = harness();
        writeFileSync(join(h.directory, 'AGENTS.md'), '# Projeto\n\nRegras da casa.\n');

        await run(h.context, ['skills', 'install', '--cursor', '--agents', '--dir', h.directory]);
        await run(h.context, ['skills', 'install', '--agents', '--dir', h.directory]);

        expect(readFileSync(join(h.directory, '.cursor/rules/nexo-api.mdc'), 'utf8')).toMatch(/^---\ndescription: Como usar a API/);
        const agents: string = readFileSync(join(h.directory, 'AGENTS.md'), 'utf8');
        expect(agents.startsWith('# Projeto\n\nRegras da casa.\n')).toBe(true);
        expect(agents.split(BLOCK_START)).toHaveLength(2);
        expect(readFileSync(join(h.directory, '.nexo/skills/nexo-dashboards.md'), 'utf8')).toContain('name: nexo-dashboards');
    });

    it('replaces only the managed block', () => {
        const before: string = `a\n\n${BLOCK_START}\nvelho\n${BLOCK_END}\n\nb\n`;

        const after: string = withAgentsBlock(before, bundledSkills());

        expect(after.startsWith('a\n\n')).toBe(true);
        expect(after.endsWith('\n\nb\n')).toBe(true);
        expect(after).not.toContain('velho');
    });
});

describe('mcp setup', () => {
    it('merges both servers into an existing .mcp.json without the token in the file', async () => {
        const h: Harness = harness();
        writeFileSync(join(h.directory, '.mcp.json'), JSON.stringify({ mcpServers: { other: { url: 'x' } } }));

        await run(h.context, ['mcp', 'setup', '--claude', '--env', 'dev', '--dir', h.directory]);

        const config: { mcpServers: Record<string, { url: string; headers?: Record<string, string> }> } = JSON.parse(
            readFileSync(join(h.directory, '.mcp.json'), 'utf8')
        ) as { mcpServers: Record<string, { url: string; headers?: Record<string, string> }> };
        expect(Object.keys(config.mcpServers)).toEqual(['other', 'nexo', 'nexo-connect']);
        expect(config.mcpServers['nexo-connect']?.url).toBe('https://mcp-nexo-dev.winningsales.com.br/connect/mcp');
        expect(config.mcpServers.nexo?.headers?.Authorization).toBe('Bearer ${NEXO_TOKEN}');
    });

    it('appends the Codex servers once', async () => {
        const h: Harness = harness();

        await run(h.context, ['mcp', 'setup', '--codex', '--dir', h.directory]);
        await run(h.context, ['mcp', 'setup', '--codex', '--dir', h.directory]);

        const toml: string = readFileSync(join(h.directory, '.codex/config.toml'), 'utf8');
        expect(toml.split('[mcp_servers.nexo]')).toHaveLength(2);
        expect(toml).toContain('bearer_token_env_var = "NEXO_TOKEN"');
    });
});
