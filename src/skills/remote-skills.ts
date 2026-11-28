import type { ApiResponse, NexoClient } from '../http/nexo-client.js';

export const REMOTE_LEVELS: readonly ['product', 'company', 'area', 'team', 'person'] = ['product', 'company', 'area', 'team', 'person'];

/** `record` is a note written about a record: only units of context come with it. */
export const CONTEXT_LEVELS: readonly [...typeof REMOTE_LEVELS, 'record'] = [...REMOTE_LEVELS, 'record'];

export type SkillLevel = (typeof CONTEXT_LEVELS)[number];

/** What the entry is: `skill`, or the type of a unit of context of the Cérebro (`base`, `preferencia`, `nota_do_caso`...). */
export const SKILL_KIND: string = 'skill';

export interface RemoteSkillEntry {
    /** The name of a skill, or the id of a unit of context: how `GET /v1/skills/{name}` finds it. */
    readonly name: string;
    readonly kind: string;
    readonly title: string;
    readonly level: SkillLevel;
    readonly status: string;
    readonly description: string;
    readonly version: string;
}

export interface RemoteSkill extends RemoteSkillEntry {
    readonly body: string;
}

export const LEVEL_LABELS: Readonly<Record<SkillLevel, string>> = {
    product: 'produto',
    company: 'empresa',
    area: 'área',
    team: 'time',
    person: 'pessoa',
    record: 'registro'
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLevel(value: unknown): value is SkillLevel {
    return CONTEXT_LEVELS.some((level: SkillLevel) => level === value);
}

interface WireEntry extends Omit<RemoteSkillEntry, 'kind' | 'title'> {
    readonly kind?: string;
    readonly title?: string;
}

/** An API from before the units of context sends neither `kind` nor `title`: it is a skill, titled by its name. */
function isEntry(value: unknown): value is WireEntry {
    return (
        isRecord(value) &&
        typeof value.name === 'string' &&
        (value.kind === undefined || typeof value.kind === 'string') &&
        (value.title === undefined || typeof value.title === 'string') &&
        isLevel(value.level) &&
        typeof value.status === 'string' &&
        typeof value.description === 'string' &&
        typeof value.version === 'string'
    );
}

function entryOf(wire: WireEntry): RemoteSkillEntry {
    return { ...wire, kind: wire.kind ?? SKILL_KIND, title: wire.title ?? wire.name };
}

function isSkill(value: unknown): value is WireEntry & { readonly body: string } {
    return isEntry(value) && typeof (value as unknown as Readonly<Record<string, unknown>>).body === 'string';
}

/** The skills and the units of context the token reaches, as `GET /v1/skills` lists them: the same reach of the copilot. */
export async function remoteIndex(client: NexoClient): Promise<readonly RemoteSkillEntry[]> {
    const response: ApiResponse = await client.request({ method: 'GET', path: '/v1/skills' });
    const skills: unknown = isRecord(response.body) ? response.body.skills : null;
    if (!Array.isArray(skills) || !skills.every(isEntry)) {
        throw new Error('Resposta inesperada de /v1/skills.');
    }
    return skills.map(entryOf);
}

export async function remoteSkill(client: NexoClient, name: string): Promise<RemoteSkill> {
    const response: ApiResponse = await client.request({ method: 'GET', path: `/v1/skills/${encodeURIComponent(name)}` });
    if (!isSkill(response.body)) {
        throw new Error(`Resposta inesperada de /v1/skills/${name}.`);
    }
    return { ...entryOf(response.body), body: response.body.body };
}

/** The skills of the company, of an area, of a team: what never goes into the project folder, where it would be committed. */
export function clientLevelOnly(skills: readonly RemoteSkillEntry[]): readonly RemoteSkillEntry[] {
    return skills.filter((skill: RemoteSkillEntry) => skill.kind === SKILL_KIND && skill.level !== 'product');
}

/** The units of context of the Cérebro: never copied to disk, only listed in the index and opened by `nexo skills show`. */
export function contextUnits(entries: readonly RemoteSkillEntry[]): readonly RemoteSkillEntry[] {
    return entries.filter((entry: RemoteSkillEntry) => entry.kind !== SKILL_KIND);
}
