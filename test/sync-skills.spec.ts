import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { skillEntriesOf, syncSkills } from '../src/skills/sync-skills.js';
import type { Download, SkillsSyncResult } from '../src/skills/sync-skills.js';

const BASE: string = 'https://nexo.test/docs/skills';

function skillFile(name: string): string {
    return `---\nname: ${name}\ndescription: Como usar ${name}. Use sempre que precisar.\n---\n\n# ${name}\n\nRode \`nexo ${name}\`.\n`;
}

function served(files: Readonly<Record<string, string>>): Download {
    return (url: string) => {
        const body: string | undefined = files[url.slice(BASE.length + 1)];
        return body === undefined ? Promise.reject(new Error(`${url} answered 404`)) : Promise.resolve(body);
    };
}

function index(names: readonly string[]): string {
    return JSON.stringify({ skills: names.map((name: string) => ({ name, description: `Como usar ${name}.`, file: `${name}.md` })) });
}

describe('skills sync from the Nexo', () => {
    it('writes every skill of the index as it is served and removes the one that left it', async () => {
        const directory: string = mkdtempSync(join(tmpdir(), 'nexo-skills-'));
        mkdirSync(join(directory, 'nexo-velha'));
        writeFileSync(join(directory, 'nexo-velha', 'SKILL.md'), skillFile('nexo-velha'));

        const result: SkillsSyncResult = await syncSkills(
            directory,
            BASE,
            served({
                'index.json': index(['nexo-api', 'nexo-nova']),
                'nexo-api.md': skillFile('nexo-api'),
                'nexo-nova.md': skillFile('nexo-nova')
            })
        );

        expect(result).toEqual({ written: ['nexo-api', 'nexo-nova'], removed: ['nexo-velha'] });
        expect(readFileSync(join(directory, 'nexo-nova', 'SKILL.md'), 'utf8')).toBe(skillFile('nexo-nova'));
        expect(existsSync(join(directory, 'nexo-velha'))).toBe(false);
    });

    it('changes nothing when a served file is not the skill the index names', async () => {
        const directory: string = mkdtempSync(join(tmpdir(), 'nexo-skills-'));
        mkdirSync(join(directory, 'nexo-api'));
        writeFileSync(join(directory, 'nexo-api', 'SKILL.md'), skillFile('nexo-api'));

        await expect(
            syncSkills(
                directory,
                BASE,
                served({
                    'index.json': index(['nexo-api', 'nexo-nova']),
                    'nexo-api.md': skillFile('nexo-api'),
                    'nexo-nova.md': skillFile('outra')
                })
            )
        ).rejects.toThrow('is not the SKILL.md of nexo-nova');
        expect(readFileSync(join(directory, 'nexo-api', 'SKILL.md'), 'utf8')).toBe(skillFile('nexo-api'));
    });

    it('refuses an index out of format instead of emptying the skills', () => {
        expect(() => skillEntriesOf('{"skills":[]}')).toThrow('format probably changed');
        expect(() => skillEntriesOf('{"skills":[{"name":"nexo-api","file":"../x.md"}]}')).toThrow('format probably changed');
        expect(() => skillEntriesOf('{"skills":[{"name":"../x","file":"../x.md"}]}')).toThrow('format probably changed');
        expect(skillEntriesOf(index(['nexo-api']))).toEqual([
            { name: 'nexo-api', description: 'Como usar nexo-api.', file: 'nexo-api.md' }
        ]);
    });
});
