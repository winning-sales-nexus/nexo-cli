import { usageError } from '../errors.js';

export interface NexoEnvironment {
    readonly apiUrl: string;
    readonly appUrl: string;
}

export const ENVIRONMENTS: Readonly<Record<string, NexoEnvironment>> = {
    prod: { apiUrl: 'https://mcp-nexo.winningsales.com.br', appUrl: 'https://app.nexo.winningsales.com.br' },
    dev: { apiUrl: 'https://mcp-nexo-dev.winningsales.com.br', appUrl: 'https://app-dev.nexo.winningsales.com.br' }
};

export const DEFAULT_ENVIRONMENT: NexoEnvironment = {
    apiUrl: 'https://mcp-nexo.winningsales.com.br',
    appUrl: 'https://app.nexo.winningsales.com.br'
};

export const TOKENS_PAGE: string = '/settings/api-tokens';

export function environmentNamed(name: string): NexoEnvironment {
    const environment: NexoEnvironment | undefined = ENVIRONMENTS[name];
    if (environment === undefined) {
        throw usageError(`Ambiente desconhecido: ${name}.`, `Use um destes: ${Object.keys(ENVIRONMENTS).join(', ')}, ou --api-url.`);
    }
    return environment;
}

export function normalizedApiUrl(raw: string): string {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        throw usageError(`Endereço da API inválido: ${raw}.`);
    }
    if (url.protocol !== 'https:' && !isLoopback(url.hostname)) {
        throw usageError('A API do Nexo só é acessada por https, fora da sua própria máquina.');
    }
    return url.origin;
}

function isLoopback(hostname: string): boolean {
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}
