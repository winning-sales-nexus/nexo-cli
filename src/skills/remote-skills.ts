import type { ApiResponse, NexoClient } from '../http/nexo-client.js';

export const REMOTE_LEVELS: readonly ['product', 'company', 'area', 'team', 'person'] = ['product', 'company', 'area', 'team', 'person'];

export type SkillLevel = (typeof REMOTE_LEVELS)[number];

export interface RemoteSkillEntry {
    readonly name: string;
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
    person: 'pessoa'
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLevel(value: unknown): value is SkillLevel {
    return REMOTE_LEVELS.some((level: SkillLevel) => level === value);
}

function isEntry(value: unknown): value is RemoteSkillEntry {
    return (
        isRecord(value) &&
        typeof value.name === 'string' &&
        isLevel(value.level) &&
        typeof value.status === 'string' &&
        typeof value.description === 'string' &&
        typeof value.version === 'string'
    );
}

function isSkill(value: unknown): value is RemoteSkill {
    return isEntry(value) && typeof (value as unknown as Readonly<Record<string, unknown>>).body === 'string';
}

/** The skills of the four levels the token reaches, as `GET /v1/skills` lists them: the same `skillsFor` of the copilot. */
export async function remoteIndex(client: NexoClient): Promise<readonly RemoteSkillEntry[]> {
    const response: ApiResponse = await client.request({ method: 'GET', path: '/v1/skills' });
    const skills: unknown = isRecord(response.body) ? response.body.skills : null;
    if (!Array.isArray(skills) || !skills.every(isEntry)) {
        throw new Error('Resposta inesperada de /v1/skills.');
    }
    return skills;
}

export async function remoteSkill(client: NexoClient, name: string): Promise<RemoteSkill> {
    const response: ApiResponse = await client.request({ method: 'GET', path: `/v1/skills/${encodeURIComponent(name)}` });
    if (!isSkill(response.body)) {
        throw new Error(`Resposta inesperada de /v1/skills/${name}.`);
    }
    return response.body;
}

/** The skills of the company, of an area, of a team: what never goes into the project folder, where it would be committed. */
export function clientLevelOnly(skills: readonly RemoteSkillEntry[]): readonly RemoteSkillEntry[] {
    return skills.filter((skill: RemoteSkillEntry) => skill.level !== 'product');
}
