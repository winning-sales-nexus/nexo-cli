import { createHash } from 'node:crypto';
import { DEFAULT_ENVIRONMENT } from '../config/environments.js';
import type { FetchFunction } from '../http/nexo-client.js';
import { bundledSkills } from './skill-files.js';
import type { Skill } from './skill-files.js';

const INDEX_PATH: string = '/docs/skills/index.json';
const TIMEOUT_MS: number = 3000;

export function sha256Of(content: string): string {
    return createHash('sha256').update(content).digest('hex');
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface HashedEntry {
    readonly name: string;
    readonly sha256: string;
}

function isHashedEntry(value: unknown): value is HashedEntry {
    return isRecord(value) && typeof value.name === 'string' && typeof value.sha256 === 'string';
}

async function hashedIndex(fetchFn: FetchFunction): Promise<readonly HashedEntry[] | null> {
    const response: Response = await fetchFn(`${DEFAULT_ENVIRONMENT.apiUrl}${INDEX_PATH}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body: unknown = response.ok ? await response.json() : null;
    const skills: unknown = isRecord(body) ? body.skills : null;
    return Array.isArray(skills) && skills.length > 0 && skills.every(isHashedEntry) ? skills : null;
}

/**
 * The product skills that came with this CLI and no longer match the ones the Nexo serves, by the SHA-256 of each file in
 * `/docs/skills/index.json`. Null when it cannot tell (no network, answer in another format): the check never fails a command.
 */
export async function staleBundledSkills(
    fetchFn: FetchFunction,
    bundled: readonly Skill[] = bundledSkills()
): Promise<readonly string[] | null> {
    try {
        const index: readonly HashedEntry[] | null = await hashedIndex(fetchFn);
        const local: ReadonlyMap<string, string> = new Map(bundled.map((skill: Skill) => [skill.name, sha256Of(skill.content)]));
        return index === null
            ? null
            : index.filter((entry: HashedEntry) => local.get(entry.name) !== entry.sha256).map((entry: HashedEntry) => entry.name);
    } catch {
        return null;
    }
}

export function staleNotice(stale: readonly string[]): string {
    return `As skills de produto que vêm com esta CLI estão velhas (${stale.join(', ')}). Atualize a CLI (npm install -g @winning-sales/nexo@latest) e rode \`nexo skills install\` de novo.`;
}
