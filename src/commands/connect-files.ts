import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assetPath } from '../assets.js';
import { clientOf, printJson, printLine, printNotice, sessionOf } from '../context.js';
import type { CliContext, GlobalOptions } from '../context.js';
import type { Session } from '../config/session.js';
import { CliError } from '../errors.js';
import { EXIT_CODES } from '../exit-codes.types.js';
import { NexoApiError } from '../http/problem.js';
import type { ApiResponse } from '../http/nexo-client.js';
import { SDK_FILE, ensureEmpty, projectDirectory, readFiles, readState, writeFiles, writeState } from '../connect/project.js';
import type { ConnectorFiles, ConnectorState } from '../connect/project.js';
import { TEMPLATE_CODE, TEMPLATE_TSCONFIG, templateManifest } from '../connect/template.js';

export interface ConnectFileOptions extends GlobalOptions {
    readonly name?: string;
    readonly system?: string;
    readonly summary?: string;
    readonly seq?: string;
}

interface SavedVersion {
    readonly connectorId: string;
    readonly version: { readonly seq: number };
    readonly pendingHosts: readonly string[];
    readonly missingSecrets: readonly string[];
    readonly link: string;
}

interface SystemRow {
    readonly id: string;
    readonly slug: string;
    readonly name: string;
    readonly docsUrl: string | null;
}

function isSaved(value: unknown): value is SavedVersion {
    return typeof value === 'object' && value !== null && typeof (value as { connectorId?: unknown }).connectorId === 'string';
}

function copySdk(directory: string): void {
    copyFileSync(assetPath(`connect/${SDK_FILE}`), join(directory, SDK_FILE));
    writeFileSync(join(directory, 'tsconfig.json'), TEMPLATE_TSCONFIG);
}

async function systemNamed(context: CliContext, options: ConnectFileOptions, slug: string): Promise<SystemRow> {
    const response: ApiResponse = await clientOf(context, sessionOf(context, options)).request({
        method: 'GET',
        path: '/v1/connect/systems'
    });
    const rows: readonly SystemRow[] = Array.isArray(response.body) ? (response.body as SystemRow[]) : [];
    const system: SystemRow | undefined = rows.find((row: SystemRow) => row.slug === slug);
    if (system === undefined) {
        throw new CliError(`Não há o sistema ${slug} no catálogo.`, EXIT_CODES.notFound, 'Veja os sistemas com `nexo connect systems`.');
    }
    return system;
}

export async function connectInit(context: CliContext, dir: string, options: ConnectFileOptions): Promise<void> {
    const directory: string = projectDirectory(dir);
    ensureEmpty(directory);
    const system: SystemRow | null = options.system === undefined ? null : await systemNamed(context, options, options.system);
    mkdirSync(directory, { recursive: true });
    writeFiles(directory, { code: TEMPLATE_CODE, manifest: templateManifest() });
    copySdk(directory);
    const name: string = options.name ?? system?.name ?? 'Novo conector';
    writeState(directory, { connectorId: null, name, systemId: system?.id ?? null, baseSeq: null });
    printLine(context, `Conector "${name}" criado em ${directory}.`);
    if (system?.docsUrl !== undefined && system.docsUrl !== null) {
        printLine(context, `Documentação do ${system.name}: ${system.docsUrl}`);
    }
    printNotice(
        context,
        'Escreva connector.ts e manifest.json, confira os tipos com `npx tsc -p .`, e suba com `nexo connect push -m "o que mudou"`.'
    );
}

async function saveVersion(
    context: CliContext,
    session: Session,
    state: ConnectorState,
    body: ConnectorFiles & { summary: string }
): Promise<SavedVersion> {
    const request: { path: string; body: unknown } =
        state.connectorId === null
            ? {
                  path: '/v1/connect/connectors',
                  body: { name: state.name, ...(state.systemId === null ? {} : { systemId: state.systemId }), ...body }
              }
            : { path: `/v1/connect/connectors/${state.connectorId}/versions`, body: { baseSeq: state.baseSeq ?? 0, ...body } };
    try {
        const response: ApiResponse = await clientOf(context, session).request({ method: 'POST', ...request });
        if (!isSaved(response.body)) {
            throw new Error('Resposta inesperada ao salvar a versão.');
        }
        return response.body;
    } catch (error: unknown) {
        if (error instanceof NexoApiError && error.problem.status === 409) {
            throw new CliError(
                error.message,
                EXIT_CODES.failure,
                'Alguém salvou outra versão antes. Rode `nexo connect pull` numa pasta nova e junte as mudanças.'
            );
        }
        throw error;
    }
}

function reportSaved(context: CliContext, saved: SavedVersion): void {
    printLine(context, `Versão ${String(saved.version.seq)} salva. Ela está em edição: ensaie com \`nexo connect rehearse\`.`);
    if (saved.pendingHosts.length > 0) {
        printLine(context, `Hosts esperando o sim de uma pessoa: ${saved.pendingHosts.join(', ')}`);
    }
    if (saved.missingSecrets.length > 0) {
        printLine(
            context,
            `Segredos a preencher (pela pessoa): ${saved.missingSecrets.join(', ')}. Use \`nexo connect secrets set <NOME>\`.`
        );
    }
    printLine(context, `Tela do conector: ${saved.link}`);
}

export async function connectPush(context: CliContext, dir: string | undefined, options: ConnectFileOptions): Promise<void> {
    const directory: string = projectDirectory(dir);
    const state: ConnectorState = readState(directory);
    const summary: string = (options.summary ?? '').trim();
    if (summary === '') {
        throw new CliError('Diga o que mudou nesta versão.', EXIT_CODES.usage, 'Use -m "o que mudou".');
    }
    const saved: SavedVersion = await saveVersion(context, sessionOf(context, options), state, { ...readFiles(directory), summary });
    writeState(directory, { ...state, connectorId: saved.connectorId, baseSeq: saved.version.seq });
    if (options.json === true) {
        printJson(context, saved);
        return;
    }
    reportSaved(context, saved);
}

interface ConnectorView {
    readonly connector: {
        readonly id: string;
        readonly name: string;
        readonly systemId: string | null;
        readonly headSeq: number;
        readonly publishedSeq: number | null;
        readonly status: string;
    };
    readonly missingSecrets: readonly string[];
    readonly pendingHosts: readonly string[];
    readonly link: string;
}

export async function fetchConnector(context: CliContext, session: Session, connectorId: string): Promise<ConnectorView> {
    const response: ApiResponse = await clientOf(context, session).request({
        method: 'GET',
        path: `/v1/connect/connectors/${connectorId}`
    });
    const body: unknown = response.body;
    if (typeof body !== 'object' || body === null || typeof (body as { connector?: unknown }).connector !== 'object') {
        throw new Error('Conector em formato inesperado.');
    }
    return body as ConnectorView;
}

export async function connectPull(
    context: CliContext,
    connectorId: string,
    dir: string | undefined,
    options: ConnectFileOptions
): Promise<void> {
    const directory: string = projectDirectory(dir ?? connectorId);
    ensureEmpty(directory);
    const session: Session = sessionOf(context, options);
    const view: ConnectorView = await fetchConnector(context, session, connectorId);
    const seq: number = options.seq === undefined ? view.connector.headSeq : Number(options.seq);
    const version: ApiResponse = await clientOf(context, session).request({
        method: 'GET',
        path: `/v1/connect/connectors/${connectorId}/versions/${String(seq)}`
    });
    const files: { code: string; manifest: Record<string, unknown> } = version.body as { code: string; manifest: Record<string, unknown> };
    writeFiles(directory, { code: files.code, manifest: files.manifest });
    copySdk(directory);
    writeState(directory, { connectorId, name: view.connector.name, systemId: view.connector.systemId, baseSeq: view.connector.headSeq });
    printLine(context, `Versão ${String(seq)} de "${view.connector.name}" em ${directory}.`);
}

export async function connectStatus(context: CliContext, dir: string | undefined, options: ConnectFileOptions): Promise<void> {
    const directory: string = projectDirectory(dir);
    const state: ConnectorState = readState(directory);
    if (state.connectorId === null) {
        printLine(context, `"${state.name}" ainda não foi enviado ao Nexo. Suba com \`nexo connect push -m "primeira versão"\`.`);
        return;
    }
    const view: ConnectorView = await fetchConnector(context, sessionOf(context, options), state.connectorId);
    if (options.json === true) {
        printJson(context, { local: state, remote: view });
        return;
    }
    const published: string = view.connector.publishedSeq === null ? 'nenhuma' : String(view.connector.publishedSeq);
    printLine(
        context,
        `${view.connector.name}: ${view.connector.status}. Versão em edição ${String(view.connector.headSeq)}, publicada ${published}, local baseada na ${String(state.baseSeq)}.`
    );
    if (state.baseSeq !== view.connector.headSeq) {
        printLine(context, 'Há uma versão mais nova no Nexo do que a desta pasta.');
    }
    printLine(
        context,
        `Segredos faltando: ${view.missingSecrets.join(', ') || 'nenhum'}. Hosts esperando: ${view.pendingHosts.join(', ') || 'nenhum'}.`
    );
    printLine(context, `Tela: ${view.link}`);
}
