import { clientOf, printJson, printLine, printNotice, sessionOf } from '../context.js';
import type { CliContext, GlobalOptions } from '../context.js';
import { usageError } from '../errors.js';
import type { ApiResponse, HttpMethod } from '../http/nexo-client.js';

export interface ArtifactOptions extends GlobalOptions {
    readonly deal?: string;
    readonly kind?: string;
    readonly page?: string;
    readonly pageSize?: string;
    readonly versionNumber?: string;
    readonly brief?: string;
}

interface ArtifactVersion {
    readonly version: number;
    readonly fileName: string;
    readonly source: string;
    readonly aiState: string | null;
    readonly createdAt: string;
}

interface ArtifactItem {
    readonly id: string;
    readonly name: string;
    readonly kind: string;
    readonly dealId: string | null;
    readonly ownerName: string | null;
    readonly currentVersion: number;
    readonly current: ArtifactVersion | null;
    readonly updatedAt: string;
}

interface ArtifactPage {
    readonly data: readonly ArtifactItem[];
    readonly pagination: { readonly page: number; readonly pageSize: number; readonly totalRecords: number; readonly totalPages: number };
}

interface ArtifactDetail extends ArtifactItem {
    readonly versions: readonly ArtifactVersion[];
}

interface SignedLink {
    readonly url: string;
    readonly expiresAt: string;
}

interface ArtifactContent {
    readonly artifactId: string;
    readonly version: number;
    readonly mimeType: string;
    readonly fileName: string;
    readonly storage: string;
    readonly sizeInBytes: number;
    readonly content: string | null;
    readonly download: SignedLink | null;
    readonly view: SignedLink | null;
}

interface DealAnalysis {
    readonly artifact: ArtifactItem;
    readonly version: ArtifactVersion;
    readonly aiState: string;
    readonly generatedAt: string;
    readonly saved: boolean;
}

const AI_STATE_LABELS: Readonly<Record<string, string>> = {
    written: 'a IA escreveu a página',
    fallback_budget: 'só os números do Nexo: o limite de IA da empresa acabou',
    fallback_invalid: 'só os números do Nexo: a IA não respeitou as regras de número',
    fallback_unavailable: 'só os números do Nexo: a IA estava indisponível',
    fallback_empty: 'só os números do Nexo: nenhum negócio ao alcance'
};

async function call(context: CliContext, options: GlobalOptions, method: HttpMethod, path: string, body?: unknown): Promise<unknown> {
    const response: ApiResponse = await clientOf(context, sessionOf(context, options)).request({
        method,
        path,
        ...(body === undefined ? {} : { body })
    });
    return response.body;
}

function versionNumber(value: string | undefined): number | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (!/^[1-9]\d*$/.test(value)) {
        throw usageError(`--version-number pede o número da versão, a partir de 1 (veio "${value}").`);
    }
    return Number(value);
}

function stateLabel(aiState: string | null): string {
    return aiState === null ? '—' : aiState;
}

function contentPath(artifactId: string, version: number): string {
    return `/v1/artifacts/${encodeURIComponent(artifactId)}/versions/${String(version)}/content`;
}

function printLink(context: CliContext, label: string, link: SignedLink | null): void {
    if (link !== null) {
        printLine(context, `${label}: ${link.url}`);
        printNotice(context, `O link vale até ${link.expiresAt}.`);
    }
}

export async function dealsAnalysis(context: CliContext, dealId: string, options: ArtifactOptions): Promise<void> {
    const brief: string | undefined = options.brief?.trim();
    const analysis: DealAnalysis = (await call(
        context,
        options,
        'POST',
        `/v1/deals/${encodeURIComponent(dealId)}/analysis`,
        brief === undefined || brief === '' ? {} : { brief }
    )) as DealAnalysis;
    const content: ArtifactContent = (await call(
        context,
        options,
        'GET',
        contentPath(analysis.artifact.id, analysis.version.version)
    )) as ArtifactContent;
    if (options.json === true) {
        printJson(context, { ...analysis, view: content.view, download: content.download });
        return;
    }
    printLine(
        context,
        `${analysis.artifact.name}: versão ${String(analysis.version.version)} (artefato ${analysis.artifact.id}), gerada em ${analysis.generatedAt}`
    );
    printLine(context, `aiState: ${analysis.aiState} (${AI_STATE_LABELS[analysis.aiState] ?? 'estado novo'})`);
    if (!analysis.saved) {
        printNotice(context, 'Nada foi gravado: a versão boa anterior continua como a atual. Tente de novo mais tarde.');
    }
    printLink(context, 'view', content.view);
}

function listQuery(dealId: string, options: ArtifactOptions): URLSearchParams {
    const query: URLSearchParams = new URLSearchParams({ dealId });
    for (const [key, value] of [
        ['kind', options.kind],
        ['page', options.page],
        ['pageSize', options.pageSize]
    ] as const) {
        if (value !== undefined) {
            query.set(key, value);
        }
    }
    return query;
}

export async function artifactsList(context: CliContext, options: ArtifactOptions): Promise<void> {
    if (options.deal === undefined) {
        throw usageError('Diga o negócio com --deal <id>.', 'A lista é sempre de um negócio.');
    }
    const query: URLSearchParams = listQuery(options.deal, options);
    const page: ArtifactPage = (await call(context, options, 'GET', `/v1/artifacts?${query.toString()}`)) as ArtifactPage;
    if (options.json === true) {
        printJson(context, page);
        return;
    }
    if (page.data.length === 0) {
        printLine(context, 'Nenhum artefato neste negócio.');
        return;
    }
    page.data.forEach((artifact: ArtifactItem) => {
        printLine(
            context,
            `${artifact.id}  ${artifact.kind.padEnd(9)} v${String(artifact.currentVersion)}  ${stateLabel(artifact.current?.aiState ?? null).padEnd(20)} ${artifact.name}`
        );
    });
    if (page.pagination.page < page.pagination.totalPages) {
        printNotice(context, `Página ${String(page.pagination.page)} de ${String(page.pagination.totalPages)}: veja a próxima com --page.`);
    }
}

async function artifactVersion(context: CliContext, artifactId: string, version: number, options: ArtifactOptions): Promise<void> {
    const content: ArtifactContent = (await call(context, options, 'GET', contentPath(artifactId, version))) as ArtifactContent;
    if (options.json === true) {
        printJson(context, content);
        return;
    }
    printLine(
        context,
        `Versão ${String(content.version)}: ${content.fileName} (${content.mimeType}, ${String(content.sizeInBytes)} bytes, ${content.storage})`
    );
    printLink(context, 'view', content.view);
    printLink(context, 'download', content.download);
    if (content.content !== null) {
        printLine(context, content.content);
    }
}

export async function artifactsGet(context: CliContext, artifactId: string, options: ArtifactOptions): Promise<void> {
    const version: number | undefined = versionNumber(options.versionNumber);
    if (version !== undefined) {
        await artifactVersion(context, artifactId, version, options);
        return;
    }
    const artifact: ArtifactDetail = (await call(
        context,
        options,
        'GET',
        `/v1/artifacts/${encodeURIComponent(artifactId)}`
    )) as ArtifactDetail;
    if (options.json === true) {
        printJson(context, artifact);
        return;
    }
    printLine(context, `${artifact.name} (${artifact.kind}), versão atual ${String(artifact.currentVersion)}`);
    printLine(context, `Negócio: ${artifact.dealId ?? '—'}  Dono: ${artifact.ownerName ?? '—'}  Atualizado em ${artifact.updatedAt}`);
    artifact.versions.forEach((each: ArtifactVersion) => {
        printLine(
            context,
            `  v${String(each.version)}  ${each.source.padEnd(10)} ${stateLabel(each.aiState).padEnd(20)} ${each.createdAt}`
        );
    });
    printNotice(context, 'Para abrir uma versão: `nexo artifacts get <id> --version-number <n>`.');
}
