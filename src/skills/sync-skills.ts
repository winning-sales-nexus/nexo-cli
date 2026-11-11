import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSkill } from './skill-files.js';
import type { Skill } from './skill-files.js';

export interface SkillIndexEntry {
    readonly name: string;
    readonly file: string;
}

export interface SkillsSyncResult {
    readonly written: readonly string[];
    readonly removed: readonly string[];
}

export type Download = (url: string) => Promise<string>;

const SKILL_NAME: RegExp = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MINIMUM_SKILLS: number = 1;

function isEntry(value: unknown): value is SkillIndexEntry {
    if (typeof value !== 'object' || value === null || !('name' in value) || !('file' in value)) {
        return false;
    }
    return typeof value.name === 'string' && SKILL_NAME.test(value.name) && value.file === `${value.name}.md`;
}

function skillsListOf(parsed: unknown): unknown {
    return typeof parsed === 'object' && parsed !== null && 'skills' in parsed ? parsed.skills : undefined;
}

export function skillEntriesOf(json: string): readonly SkillIndexEntry[] {
    const skills: unknown = skillsListOf(JSON.parse(json));
    if (!Array.isArray(skills) || skills.length < MINIMUM_SKILLS || !skills.every(isEntry)) {
        throw new Error(
            'the skills index is not { skills: [{ name, file }] } with a file named after each skill; the format probably changed'
        );
    }
    return skills;
}

async function checkedSkill(base: string, entry: SkillIndexEntry, download: Download): Promise<string> {
    const content: string = await download(`${base}/${entry.file}`);
    const skill: Skill = parseSkill(content);
    if (skill.name !== entry.name || skill.description === '' || skill.body === '') {
        throw new Error(`${entry.file} is not the SKILL.md of ${entry.name}`);
    }
    return content;
}

export async function syncSkills(directory: string, base: string, download: Download): Promise<SkillsSyncResult> {
    const entries: readonly SkillIndexEntry[] = skillEntriesOf(await download(`${base}/index.json`));
    const contents: readonly string[] = await Promise.all(entries.map((entry: SkillIndexEntry) => checkedSkill(base, entry, download)));
    const wanted: ReadonlySet<string> = new Set(entries.map((entry: SkillIndexEntry) => entry.name));
    const present: readonly string[] = existsSync(directory)
        ? readdirSync(directory, { withFileTypes: true })
              .filter((entry) => entry.isDirectory())
              .map((entry) => entry.name)
        : [];
    const removed: readonly string[] = present.filter((name: string) => !wanted.has(name));
    for (const name of removed) {
        rmSync(join(directory, name), { recursive: true });
    }
    const written: readonly string[] = entries.map((entry: SkillIndexEntry, position: number) => {
        const target: string = join(directory, entry.name, 'SKILL.md');
        mkdirSync(join(directory, entry.name), { recursive: true });
        writeFileSync(target, contents[position] ?? '');
        return entry.name;
    });
    return { written, removed };
}
