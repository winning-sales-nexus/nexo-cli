import { readdirSync } from 'node:fs';
import { assetPath, readAsset } from '../assets.js';

export interface Skill {
    readonly name: string;
    readonly description: string;
    readonly content: string;
    readonly body: string;
}

const FRONTMATTER: RegExp = /^---\n([\s\S]*?)\n---\n/;

function fieldOf(frontmatter: string, field: string): string {
    const line: string | undefined = frontmatter.split('\n').find((candidate: string) => candidate.startsWith(`${field}:`));
    return line === undefined ? '' : line.slice(field.length + 1).trim();
}

export function parseSkill(content: string): Skill {
    const match: RegExpExecArray | null = FRONTMATTER.exec(content);
    const frontmatter: string = match?.[1] ?? '';
    return {
        name: fieldOf(frontmatter, 'name'),
        description: fieldOf(frontmatter, 'description'),
        content,
        body: content.slice(match?.[0].length ?? 0).trim()
    };
}

export function bundledSkills(): readonly Skill[] {
    return readdirSync(assetPath('skills'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => parseSkill(readAsset(`skills/${entry.name}/SKILL.md`)))
        .sort((left: Skill, right: Skill) => left.name.localeCompare(right.name));
}
