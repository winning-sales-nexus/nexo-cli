import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { RemoteSkill } from './remote-skills.js';
import { LEVEL_LABELS } from './remote-skills.js';
import type { SkillTarget } from './skill-targets.types.js';

/**
 * The skills of the company, area, team and person live in the folder of the user, never in the project's: in the project they would
 * be committed, and a personal skill would leak into the repository. Each file carries the profile in the folder name and a marker.
 */
export type UserTool = 'claude' | 'cursor' | 'codex';

export const USER_TOOLS: readonly UserTool[] = ['claude', 'cursor', 'codex'];

const USER_DIRECTORIES: Readonly<Record<UserTool, readonly string[]>> = {
    claude: ['.claude', 'skills'],
    cursor: ['.cursor', 'skills'],
    codex: ['.codex', 'skills']
};

const CURSOR_READS: readonly UserTool[] = ['claude', 'codex'];

const MARKER: string = '.nexo-profile';

const TOOL_OF_TARGET: Readonly<Record<SkillTarget, UserTool>> = { claude: 'claude', cursor: 'cursor', agents: 'codex' };

export function homeOf(env: NodeJS.ProcessEnv): string {
    return env.HOME ?? homedir();
}

export function userSkillsDirectory(home: string, tool: UserTool): string {
    return join(home, ...USER_DIRECTORIES[tool]);
}

/**
 * The tools that receive the skills of the client. Cursor also reads the folders of Claude Code and of Codex, so whoever uses Cursor with
 * one of them gets each skill in a single folder (the one of Claude Code, when it is there), or Cursor would load it twice.
 */
export function userToolsFor(home: string, targets: readonly SkillTarget[]): readonly UserTool[] {
    const chosen: ReadonlySet<UserTool> = new Set(targets.map((target: SkillTarget) => TOOL_OF_TARGET[target]));
    if (!chosen.has('cursor')) {
        return USER_TOOLS.filter((tool: UserTool) => chosen.has(tool));
    }
    const reader: UserTool | undefined = CURSOR_READS.find(
        (tool: UserTool) => chosen.has(tool) || existsSync(dirname(userSkillsDirectory(home, tool)))
    );
    return [reader ?? 'cursor'];
}

function slugOf(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

export function folderNameOf(profile: string, skill: Pick<RemoteSkill, 'name' | 'status'>): string {
    const test: string = skill.status === 'tentative' ? 'em-teste-' : '';
    return `nexo-${slugOf(profile)}-${test}${slugOf(skill.name)}`;
}

function oneLine(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

export function userSkillFileOf(profile: string, skill: RemoteSkill, now: Date): string {
    const test: string = skill.status === 'tentative' ? '[em teste, só nesta máquina] ' : '';
    return [
        '---',
        `name: ${folderNameOf(profile, skill)}`,
        `description: ${JSON.stringify(`${test}${oneLine(skill.description)}`)}`,
        'metadata:',
        `  nexo-profile: ${JSON.stringify(profile)}`,
        `  nexo-level: ${skill.level}`,
        `  nexo-level-label: ${LEVEL_LABELS[skill.level]}`,
        `  nexo-version: ${JSON.stringify(skill.version)}`,
        `  nexo-installed-at: ${now.toISOString()}`,
        '---',
        '',
        skill.body.trim(),
        ''
    ].join('\n');
}

function foldersOf(directory: string, profile: string): readonly string[] {
    if (!existsSync(directory)) {
        return [];
    }
    return readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.startsWith('nexo-'))
        .map((entry) => join(directory, entry.name))
        .filter((folder: string) => {
            const marker: string = join(folder, MARKER);
            return existsSync(marker) && readFileSync(marker, 'utf8').trim() === profile;
        });
}

/** Removes what this profile left in the three folders of the user; the product skills of the project and other profiles stay. */
export function removeUserSkills(home: string, profile: string): readonly string[] {
    const removed: string[] = USER_TOOLS.flatMap((tool: UserTool) => foldersOf(userSkillsDirectory(home, tool), profile));
    for (const folder of removed) {
        rmSync(folder, { recursive: true, force: true });
    }
    return removed;
}

/** Writes the skills of the client for the profile: first it clears what the profile had, so a skill that left the reach is gone. */
export function writeUserSkills(
    home: string,
    tools: readonly UserTool[],
    profile: string,
    skills: readonly RemoteSkill[],
    now: Date = new Date()
): readonly string[] {
    removeUserSkills(home, profile);
    return tools.flatMap((tool: UserTool) =>
        skills.map((skill: RemoteSkill) => {
            const folder: string = join(userSkillsDirectory(home, tool), folderNameOf(profile, skill));
            mkdirSync(folder, { recursive: true });
            writeFileSync(join(folder, MARKER), `${profile}\n`);
            const file: string = join(folder, 'SKILL.md');
            writeFileSync(file, userSkillFileOf(profile, skill, now));
            return file;
        })
    );
}

export function installedUserTools(home: string, profile: string, skill: Pick<RemoteSkill, 'name' | 'status'>): readonly UserTool[] {
    return USER_TOOLS.filter((tool: UserTool) =>
        existsSync(join(userSkillsDirectory(home, tool), folderNameOf(profile, skill), 'SKILL.md'))
    );
}
