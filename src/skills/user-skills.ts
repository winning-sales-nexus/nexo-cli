import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { RemoteSkill, RemoteSkillEntry } from './remote-skills.js';
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

export interface UserSkillsSync {
    /** Files written: skills that were new or whose version changed. */
    readonly written: readonly string[];
    /** Skills already in every folder at the version the API lists: not downloaded and not rewritten, only their date refreshed. */
    readonly upToDate: readonly string[];
    /** Folders of this profile that are no longer in the reach (skill excluded, team left, no longer active). */
    readonly removed: readonly string[];
}

export type LoadSkill = (entry: RemoteSkillEntry) => Promise<RemoteSkill>;

const VERSION_LINE: RegExp = /^ {2}nexo-version: (.*)$/m;
const LEVEL_LINE: RegExp = /^ {2}nexo-level: (.*)$/m;
const INSTALLED_AT_LINE: RegExp = /^( {2}nexo-installed-at: ).*$/m;

function isCurrent(folder: string, profile: string, entry: RemoteSkillEntry): boolean {
    const marker: string = join(folder, MARKER);
    const file: string = join(folder, 'SKILL.md');
    if (!existsSync(marker) || !existsSync(file) || readFileSync(marker, 'utf8').trim() !== profile) {
        return false;
    }
    const content: string = readFileSync(file, 'utf8');
    const version: string | undefined = VERSION_LINE.exec(content)?.[1];
    const level: string | undefined = LEVEL_LINE.exec(content)?.[1];
    return version === JSON.stringify(entry.version) && level === entry.level;
}

function folderOf(home: string, tool: UserTool, profile: string, entry: RemoteSkillEntry): string {
    return join(userSkillsDirectory(home, tool), folderNameOf(profile, entry));
}

function writeSkill(folder: string, profile: string, fresh: RemoteSkill, now: Date): string {
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, MARKER), `${profile}\n`);
    const file: string = join(folder, 'SKILL.md');
    writeFileSync(file, userSkillFileOf(profile, fresh, now));
    return file;
}

function refreshDate(folder: string, now: Date): void {
    const file: string = join(folder, 'SKILL.md');
    writeFileSync(file, readFileSync(file, 'utf8').replace(INSTALLED_AT_LINE, `$1${now.toISOString()}`));
}

interface Slot {
    readonly folder: string;
    readonly entry: RemoteSkillEntry;
    readonly current: boolean;
}

/**
 * Brings the folders of the user to what the API lists for the profile, comparing versions instead of wiping and rewriting: a skill whose
 * version did not change is neither downloaded nor rewritten (only its date is refreshed, which is what the "older than a day" rule reads),
 * a new or changed one is written, and what left the reach is removed. Every body is downloaded before anything is touched, so a network
 * failure in the middle leaves the folders as they were.
 */
export async function syncUserSkills(
    home: string,
    tools: readonly UserTool[],
    profile: string,
    entries: readonly RemoteSkillEntry[],
    load: LoadSkill,
    now: Date = new Date()
): Promise<UserSkillsSync> {
    const slots: readonly Slot[] = tools.flatMap((tool: UserTool) =>
        entries.map((entry: RemoteSkillEntry) => {
            const folder: string = folderOf(home, tool, profile, entry);
            return { folder, entry, current: isCurrent(folder, profile, entry) };
        })
    );
    const stale: ReadonlySet<RemoteSkillEntry> = new Set(slots.filter((slot: Slot) => !slot.current).map((slot: Slot) => slot.entry));
    const loaded: readonly RemoteSkill[] = await Promise.all([...stale].map(load));
    const bodies: ReadonlyMap<string, RemoteSkill> = new Map(loaded.map((skill: RemoteSkill) => [skill.name, skill]));
    const wanted: ReadonlySet<string> = new Set(slots.map((slot: Slot) => slot.folder));
    const removed: readonly string[] = USER_TOOLS.flatMap((tool: UserTool) => foldersOf(userSkillsDirectory(home, tool), profile)).filter(
        (folder: string) => !wanted.has(folder)
    );
    for (const folder of removed) {
        rmSync(folder, { recursive: true, force: true });
    }
    const written: readonly string[] = slots.flatMap((slot: Slot) => {
        const fresh: RemoteSkill | undefined = bodies.get(slot.entry.name);
        if (slot.current || fresh === undefined) {
            refreshDate(slot.folder, now);
            return [];
        }
        return [writeSkill(slot.folder, profile, fresh, now)];
    });
    const upToDate: readonly string[] = entries
        .filter((entry: RemoteSkillEntry) => !stale.has(entry))
        .map((entry: RemoteSkillEntry) => entry.name);
    return { written, upToDate, removed };
}

export function installedUserTools(home: string, profile: string, skill: Pick<RemoteSkill, 'name' | 'status'>): readonly UserTool[] {
    return USER_TOOLS.filter((tool: UserTool) =>
        existsSync(join(userSkillsDirectory(home, tool), folderNameOf(profile, skill), 'SKILL.md'))
    );
}
