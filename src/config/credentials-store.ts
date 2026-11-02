import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CliError } from '../errors.js';
import { EXIT_CODES } from '../exit-codes.types.js';

export interface PersonalTokenProfile {
    readonly kind: 'pat';
    readonly apiUrl: string;
    readonly token: string;
    readonly savedAt: string;
}

export interface OAuthProfile {
    readonly kind: 'oauth';
    readonly apiUrl: string;
    readonly accessToken: string;
    readonly refreshToken: string;
    readonly expiresAt: string;
    readonly scope: string;
    readonly savedAt: string;
}

export type StoredProfile = PersonalTokenProfile | OAuthProfile;

interface CredentialsFile {
    readonly version: 1;
    readonly profiles: Readonly<Record<string, StoredProfile>>;
}

const EMPTY: CredentialsFile = { version: 1, profiles: {} };

export function configDirectory(env: NodeJS.ProcessEnv = process.env): string {
    const base: string = env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
    return join(base, 'nexo');
}

function isStoredProfile(value: unknown): value is StoredProfile {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const entry: Partial<Record<keyof PersonalTokenProfile | keyof OAuthProfile, unknown>> = value;
    if (typeof entry.apiUrl !== 'string') {
        return false;
    }
    if (entry.kind === 'pat') {
        return typeof entry.token === 'string';
    }
    return (
        entry.kind === 'oauth' &&
        typeof entry.accessToken === 'string' &&
        typeof entry.refreshToken === 'string' &&
        typeof entry.expiresAt === 'string'
    );
}

function profilesOf(value: unknown): Record<string, StoredProfile> {
    if (typeof value !== 'object' || value === null) {
        return {};
    }
    const profiles: Record<string, StoredProfile> = {};
    for (const [name, entry] of Object.entries(value)) {
        if (isStoredProfile(entry)) {
            profiles[name] = entry;
        }
    }
    return profiles;
}

export class CredentialsStore {
    private readonly file: string;

    public constructor(private readonly directory: string = configDirectory()) {
        this.file = join(directory, 'credentials.json');
    }

    public get path(): string {
        return this.file;
    }

    public profile(name: string): StoredProfile | null {
        return this.read().profiles[name] ?? null;
    }

    public save(name: string, profile: StoredProfile): void {
        const current: CredentialsFile = this.read();
        this.write({ version: 1, profiles: { ...current.profiles, [name]: profile } });
    }

    public remove(name: string): boolean {
        const current: CredentialsFile = this.read();
        if (current.profiles[name] === undefined) {
            return false;
        }
        const rest: Record<string, StoredProfile> = Object.fromEntries(Object.entries(current.profiles).filter(([key]) => key !== name));
        this.write({ version: 1, profiles: rest });
        return true;
    }

    private read(): CredentialsFile {
        if (!existsSync(this.file)) {
            return EMPTY;
        }
        try {
            const parsed: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
            const profiles: unknown = typeof parsed === 'object' && parsed !== null ? (parsed as { profiles?: unknown }).profiles : null;
            return { version: 1, profiles: profilesOf(profiles) };
        } catch {
            throw new CliError(`Não consegui ler ${this.file}.`, EXIT_CODES.failure, 'Apague o arquivo e rode `nexo login` de novo.');
        }
    }

    private write(content: CredentialsFile): void {
        mkdirSync(this.directory, { recursive: true, mode: 0o700 });
        const temporary: string = `${this.file}.${String(process.pid)}.tmp`;
        writeFileSync(temporary, `${JSON.stringify(content, null, 2)}\n`, { mode: 0o600 });
        renameSync(temporary, this.file);
        chmodSync(this.file, 0o600);
    }
}
