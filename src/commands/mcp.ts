import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DEFAULT_ENVIRONMENT, environmentNamed } from '../config/environments.js';
import { currentSession, profileName } from '../config/session.js';
import type { Session } from '../config/session.js';
import { printJson, printLine, printNotice } from '../context.js';
import type { CliContext, GlobalOptions } from '../context.js';
import { CliError, usageError } from '../errors.js';
import { EXIT_CODES } from '../exit-codes.types.js';

export interface McpOptions extends GlobalOptions {
    readonly dir?: string;
    readonly claude?: boolean;
    readonly cursor?: boolean;
    readonly codex?: boolean;
    readonly env?: string;
}

interface McpServer {
    readonly name: string;
    readonly url: string;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function serversOf(apiUrl: string): readonly McpServer[] {
    return [
        { name: 'nexo', url: `${apiUrl}/mcp` },
        { name: 'nexo-connect', url: `${apiUrl}/connect/mcp` }
    ];
}

function apiUrlOf(context: CliContext, options: McpOptions): string {
    if (options.env !== undefined) {
        return environmentNamed(options.env).apiUrl;
    }
    const session: Session | null = currentSession(context.store, profileName(options.profile, context.env), context.env);
    return session?.apiUrl ?? DEFAULT_ENVIRONMENT.apiUrl;
}

function readJson(path: string): JsonObject {
    if (!existsSync(path)) {
        return {};
    }
    try {
        const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
        return isObject(parsed) ? parsed : {};
    } catch {
        throw new CliError(`${path} não é JSON válido; não mexi nele.`, EXIT_CODES.failure);
    }
}

function mergeServers(path: string, entries: Readonly<Record<string, unknown>>): string {
    const current: JsonObject = readJson(path);
    const servers: JsonObject = isObject(current.mcpServers) ? current.mcpServers : {};
    const next: JsonObject = { ...current, mcpServers: { ...servers, ...entries } };
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
    return path;
}

function claudeEntries(servers: readonly McpServer[]): Record<string, unknown> {
    return Object.fromEntries(
        servers.map((server: McpServer) => [
            server.name,
            { type: 'http', url: server.url, headers: { Authorization: 'Bearer ${NEXO_TOKEN}' } }
        ])
    );
}

function cursorEntries(servers: readonly McpServer[]): Record<string, unknown> {
    return Object.fromEntries(
        servers.map((server: McpServer) => [server.name, { url: server.url, headers: { Authorization: 'Bearer ${env:NEXO_TOKEN}' } }])
    );
}

function codexBlock(servers: readonly McpServer[]): string {
    return servers
        .map(
            (server: McpServer) =>
                `[mcp_servers.${server.name}]\nurl = "${server.url}"\nbearer_token_env_var = "NEXO_TOKEN"\ndefault_tools_approval_mode = "writes"\n`
        )
        .join('\n');
}

function writeCodex(path: string, servers: readonly McpServer[]): string {
    const current: string = existsSync(path) ? readFileSync(path, 'utf8') : '';
    const missing: readonly McpServer[] = servers.filter((server: McpServer) => !current.includes(`[mcp_servers.${server.name}]`));
    if (missing.length === 0) {
        return path;
    }
    const separator: string = current === '' || current.endsWith('\n\n') ? '' : current.endsWith('\n') ? '\n' : '\n\n';
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${current}${separator}${codexBlock(missing)}`);
    return path;
}

export function mcpSetup(context: CliContext, options: McpOptions): void {
    if (options.claude !== true && options.cursor !== true && options.codex !== true) {
        throw usageError('Escolha o cliente: --claude, --cursor ou --codex (pode mais de um).');
    }
    const directory: string = resolve(options.dir ?? '.');
    const servers: readonly McpServer[] = serversOf(apiUrlOf(context, options));
    const written: string[] = [];
    if (options.claude === true) {
        written.push(mergeServers(join(directory, '.mcp.json'), claudeEntries(servers)));
    }
    if (options.cursor === true) {
        written.push(mergeServers(join(directory, '.cursor', 'mcp.json'), cursorEntries(servers)));
    }
    if (options.codex === true) {
        written.push(writeCodex(join(directory, '.codex', 'config.toml'), servers));
    }
    if (options.json === true) {
        printJson(context, { servers, files: written });
        return;
    }
    written.forEach((file: string) => {
        printLine(context, `  ${file}`);
    });
    printNotice(
        context,
        'O token vem de NEXO_TOKEN no ambiente do cliente; ele não fica no arquivo. No Codex, o projeto precisa ser confiável.'
    );
}
