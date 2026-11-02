import { CliError } from '../errors.js';
import { EXIT_CODES } from '../exit-codes.types.js';
import type { TokenSource } from '../auth/token-source.js';
import { USER_AGENT } from '../version.js';
import { NexoApiError, problemOf } from './problem.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiRequest {
    readonly method: HttpMethod;
    readonly path: string;
    readonly query?: Readonly<Record<string, string>>;
    readonly body?: unknown;
}

export interface ApiResponse {
    readonly status: number;
    readonly body: unknown;
}

export type FetchFunction = (input: string, init: RequestInit) => Promise<Response>;

export function apiPath(raw: string): string {
    const trimmed: string = raw.replace(/^\/+/, '');
    return trimmed.startsWith('v1/') || trimmed === 'v1' ? `/${trimmed}` : `/v1/${trimmed}`;
}

async function bodyOf(response: Response): Promise<unknown> {
    const text: string = await response.text();
    if (text === '') {
        return null;
    }
    const type: string = response.headers.get('content-type') ?? '';
    if (!type.includes('json')) {
        return text;
    }
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return text;
    }
}

export class NexoClient {
    public constructor(
        private readonly apiUrl: string,
        private readonly tokens: TokenSource,
        private readonly fetchFn: FetchFunction = fetch
    ) {}

    public async request(request: ApiRequest): Promise<ApiResponse> {
        let response: Response = await this.send(request, await this.tokens.current());
        if (response.status === 401) {
            const renewed: string | null = await this.tokens.renewed();
            response = renewed === null ? response : await this.send(request, renewed);
        }
        const body: unknown = await bodyOf(response);
        if (!response.ok) {
            throw new NexoApiError(problemOf(response.status, body));
        }
        return { status: response.status, body };
    }

    private async send(request: ApiRequest, token: string): Promise<Response> {
        const url: URL = new URL(apiPath(request.path), this.apiUrl);
        for (const [key, value] of Object.entries(request.query ?? {})) {
            url.searchParams.append(key, value);
        }
        try {
            return await this.fetchFn(url.toString(), {
                method: request.method,
                headers: this.headers(token, request.body !== undefined),
                ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) })
            });
        } catch (error: unknown) {
            const reason: string = error instanceof Error ? error.message : String(error);
            throw new CliError(`Não consegui falar com ${this.apiUrl}: ${reason}.`, EXIT_CODES.failure);
        }
    }

    private headers(token: string, hasBody: boolean): Record<string, string> {
        const headers: Record<string, string> = {
            authorization: `Bearer ${token}`,
            accept: 'application/json',
            'user-agent': USER_AGENT
        };
        if (hasBody) {
            headers['content-type'] = 'application/json';
        }
        return headers;
    }
}
