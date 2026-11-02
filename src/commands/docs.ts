import { readAsset } from '../assets.js';
import { printJson, printLine } from '../context.js';
import type { CliContext, GlobalOptions } from '../context.js';
import { CliError, usageError } from '../errors.js';
import { EXIT_CODES } from '../exit-codes.types.js';
import { splitPages } from '../docs/pages.js';
import type { DocBundle, DocPage } from '../docs/pages.js';
import { pageNamed, searchPages } from '../docs/search.js';
import type { SearchHit } from '../docs/search.js';

export interface DocsOptions extends GlobalOptions {
    readonly online?: boolean;
    readonly limit?: string;
}

const ONLINE_SOURCE: string = 'https://docs.nexo.winningsales.com.br/llms-full.txt';
const SITE: string = 'https://docs.nexo.winningsales.com.br';

function isBundle(value: unknown): value is DocBundle {
    return typeof value === 'object' && value !== null && Array.isArray((value as { pages?: unknown }).pages);
}

function bundledPages(): DocBundle {
    const parsed: unknown = JSON.parse(readAsset('docs/pages.json'));
    if (!isBundle(parsed)) {
        throw new CliError('A documentação embutida está corrompida.', EXIT_CODES.failure, 'Reinstale a CLI, ou use --online.');
    }
    return parsed;
}

async function onlinePages(context: CliContext): Promise<DocBundle> {
    const response: Response = await context.fetchFn(ONLINE_SOURCE, { method: 'GET', headers: { accept: 'text/plain' } });
    if (!response.ok) {
        throw new CliError(`O site de docs respondeu ${String(response.status)}.`, EXIT_CODES.failure, 'Tente sem --online.');
    }
    return { source: ONLINE_SOURCE, fetchedAt: new Date().toISOString(), pages: splitPages(await response.text()) };
}

async function pagesFor(context: CliContext, options: DocsOptions): Promise<DocBundle> {
    return options.online === true ? onlinePages(context) : bundledPages();
}

function limitOf(raw: string | undefined): number {
    const limit: number = Number(raw ?? '8');
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        throw usageError('--limit vai de 1 a 50.');
    }
    return limit;
}

export async function docsList(context: CliContext, options: DocsOptions): Promise<void> {
    const bundle: DocBundle = await pagesFor(context, options);
    if (options.json === true) {
        printJson(context, {
            fetchedAt: bundle.fetchedAt,
            pages: bundle.pages.map(({ slug, title, description }) => ({ slug, title, description }))
        });
        return;
    }
    for (const page of bundle.pages) {
        printLine(context, `${page.slug}\n    ${page.title}: ${page.description}`);
    }
    printLine(context, `\nDocumentação de ${bundle.fetchedAt.slice(0, 10)}. Site: ${SITE}`);
}

export async function docsSearch(context: CliContext, query: string, options: DocsOptions): Promise<void> {
    const hits: readonly SearchHit[] = searchPages((await pagesFor(context, options)).pages, query, limitOf(options.limit));
    if (options.json === true) {
        printJson(
            context,
            hits.map((hit: SearchHit) => ({ slug: hit.page.slug, title: hit.page.title, score: hit.score, snippet: hit.snippet }))
        );
        return;
    }
    if (hits.length === 0) {
        printLine(context, `Nada encontrado para "${query}". Tente outras palavras, ou \`nexo docs list\`.`);
        return;
    }
    for (const hit of hits) {
        printLine(context, `${hit.page.slug}  (${hit.page.title})\n    ${hit.snippet}`);
    }
}

export async function docsShow(context: CliContext, name: string, options: DocsOptions): Promise<void> {
    const page: DocPage | null = pageNamed((await pagesFor(context, options)).pages, name);
    if (page === null) {
        throw new CliError(
            `Nenhuma página única com "${name}".`,
            EXIT_CODES.notFound,
            'Veja os nomes com `nexo docs list` ou busque com `nexo docs search`.'
        );
    }
    if (options.json === true) {
        printJson(context, page);
        return;
    }
    printLine(context, `# ${page.title}\n\n> ${page.description}\n\n${page.body}`);
}
