import { notLoggedIn } from '../errors.js';
import type { CredentialsStore, StoredProfile } from './credentials-store.js';
import { DEFAULT_ENVIRONMENT, normalizedApiUrl } from './environments.js';

export interface Session {
    readonly apiUrl: string;
    readonly source: 'env' | 'profile';
    readonly profile: string;
    readonly stored: StoredProfile | null;
    readonly token: string;
}

export const DEFAULT_PROFILE: string = 'default';

export function profileName(option: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
    return option ?? env.NEXO_PROFILE ?? DEFAULT_PROFILE;
}

function tokenOf(stored: StoredProfile): string {
    return stored.kind === 'pat' ? stored.token : stored.accessToken;
}

export function currentSession(store: CredentialsStore, profile: string, env: NodeJS.ProcessEnv = process.env): Session | null {
    const stored: StoredProfile | null = store.profile(profile);
    const token: string | undefined = env.NEXO_TOKEN;
    if (token !== undefined && token !== '') {
        const apiUrl: string = env.NEXO_API_URL ?? stored?.apiUrl ?? DEFAULT_ENVIRONMENT.apiUrl;
        return { apiUrl: normalizedApiUrl(apiUrl), source: 'env', profile, stored: null, token };
    }
    if (stored === null) {
        return null;
    }
    return { apiUrl: normalizedApiUrl(env.NEXO_API_URL ?? stored.apiUrl), source: 'profile', profile, stored, token: tokenOf(stored) };
}

export function requiredSession(store: CredentialsStore, profile: string, env: NodeJS.ProcessEnv = process.env): Session {
    const session: Session | null = currentSession(store, profile, env);
    if (session === null) {
        throw notLoggedIn();
    }
    return session;
}
