import type { CredentialsStore, OAuthProfile } from '../config/credentials-store.js';
import { CliError } from '../errors.js';
import { EXIT_CODES } from '../exit-codes.types.js';
import type { FetchFunction } from '../http/nexo-client.js';
import { refreshTokens } from './oauth.js';
import type { TokenSet } from './oauth.js';

export interface TokenSource {
    readonly current: () => Promise<string>;
    readonly renewed: () => Promise<string | null>;
}

const RENEW_MARGIN_MS: number = 60_000;

export function staticTokenSource(token: string): TokenSource {
    return { current: () => Promise.resolve(token), renewed: () => Promise.resolve(null) };
}

export function oauthProfileOf(apiUrl: string, tokens: TokenSet): OAuthProfile {
    return { kind: 'oauth', apiUrl, ...tokens, savedAt: new Date().toISOString() };
}

export class OAuthTokenSource implements TokenSource {
    private profile: OAuthProfile;
    private renewal: Promise<string> | null = null;

    public constructor(
        private readonly store: CredentialsStore,
        private readonly name: string,
        initial: OAuthProfile,
        private readonly fetchFn: FetchFunction
    ) {
        this.profile = initial;
    }

    public readonly current = async (): Promise<string> => {
        if (Date.parse(this.profile.expiresAt) - Date.now() > RENEW_MARGIN_MS) {
            return this.profile.accessToken;
        }
        return this.renew();
    };

    public readonly renewed = async (): Promise<string | null> => this.renew();

    private renew(): Promise<string> {
        this.renewal ??= this.refresh().finally(() => {
            this.renewal = null;
        });
        return this.renewal;
    }

    private async refresh(): Promise<string> {
        const tokens: TokenSet | null = await refreshTokens(this.fetchFn, this.profile.apiUrl, this.profile.refreshToken);
        if (tokens === null) {
            this.store.remove(this.name);
            throw new CliError('O acesso da CLI ao Nexo acabou ou foi revogado.', EXIT_CODES.unauthenticated, 'Rode `nexo login` de novo.');
        }
        this.profile = oauthProfileOf(this.profile.apiUrl, tokens);
        this.store.save(this.name, this.profile);
        return this.profile.accessToken;
    }
}
