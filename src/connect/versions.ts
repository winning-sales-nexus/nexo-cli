export interface VersionSummary {
    readonly seq: number;
    readonly origin: string;
    readonly restoredFromSeq: number | null;
    readonly summary: string | null;
    readonly authorUserId: string | null;
    readonly rehearsed: boolean;
    readonly needsFullRehearsal?: boolean;
    readonly createdAt: string;
}

export interface VersionFiles extends VersionSummary {
    readonly code: string;
    readonly manifest: Record<string, unknown>;
}

export interface VersionDiff {
    readonly fromSeq: number;
    readonly toSeq: number;
    readonly same: boolean;
    readonly code: string;
    readonly manifest: string;
}

const ORIGINS: Readonly<Record<string, string>> = {
    copilot: 'copiloto',
    mcp: 'MCP',
    api: 'API/CLI',
    restore: 'restauração'
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isVersionList(value: unknown): value is readonly VersionSummary[] {
    return Array.isArray(value) && value.every((item: unknown) => isRecord(item) && typeof item.seq === 'number');
}

export function isVersionFiles(value: unknown): value is VersionFiles {
    return isRecord(value) && typeof value.seq === 'number' && typeof value.code === 'string' && isRecord(value.manifest);
}

export function isVersionDiff(value: unknown): value is VersionDiff {
    return isRecord(value) && typeof value.same === 'boolean' && typeof value.code === 'string' && typeof value.manifest === 'string';
}

export function describeVersion(version: VersionSummary, marks: { readonly head: number; readonly published: number | null }): string {
    const flags: readonly string[] = [
        ...(version.seq === marks.published ? ['publicada'] : []),
        ...(version.seq === marks.head ? ['em edição'] : []),
        ...(version.rehearsed ? ['ensaio limpo'] : version.needsFullRehearsal === true ? ['falta ensaio completo'] : [])
    ];
    const origin: string = ORIGINS[version.origin] ?? version.origin;
    const author: string = version.authorUserId === null ? '' : ` ${version.authorUserId.slice(0, 8)}`;
    const restored: string = version.restoredFromSeq === null ? '' : ` da v${String(version.restoredFromSeq)}`;
    return [
        `v${String(version.seq).padEnd(3)} ${version.createdAt.slice(0, 16).replace('T', ' ')}  ${origin}${restored}${author}`,
        `${version.summary ?? '(sem resumo)'}`,
        flags.length === 0 ? '' : `[${flags.join(', ')}]`
    ]
        .filter((part: string) => part !== '')
        .join('  ');
}

/** Mesma comparação do que sobe com `push`: o código sem a quebra final, o manifesto como JSON. */
export function sameFiles(
    local: { readonly code: string; readonly manifest: Record<string, unknown> },
    remote: { readonly code: string; readonly manifest: Record<string, unknown> }
): boolean {
    return (
        local.code.trimEnd() === remote.code.trimEnd() &&
        JSON.stringify(sortKeys(local.manifest)) === JSON.stringify(sortKeys(remote.manifest))
    );
}

function sortKeys(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortKeys);
    }
    if (isRecord(value)) {
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .map((key: string): [string, unknown] => [key, sortKeys(value[key])])
        );
    }
    return value;
}
