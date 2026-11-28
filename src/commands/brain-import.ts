import type { Dirent } from 'node:fs';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { clientOf, printJson, printLine, printNotice, sessionOf } from '../context.js';
import type { CliContext } from '../context.js';
import { CliError, usageError } from '../errors.js';
import { EXIT_CODES } from '../exit-codes.types.js';
import { NexoApiError } from '../http/problem.js';
import type { ApiResponse, HttpMethod } from '../http/nexo-client.js';
import { ask, isInteractive } from '../input/ask.js';
import { confirmed } from '../input/confirm.js';
import type { BrainOptions } from './brain.js';

const IMPORTS_PATH: string = '/v1/knowledge/imports';
const MAX_FILES: number = 50;
const MAX_FILE_BYTES: number = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES: number = 100 * 1024 * 1024;
const DEFAULT_POLL_MS: number = 2000;
const MAX_WAIT_MS: number = 30 * 60 * 1000;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    md: 'text/markdown; charset=utf-8',
    markdown: 'text/markdown; charset=utf-8',
    txt: 'text/plain; charset=utf-8'
};

const SKILL_FILE: RegExp = /^skill\.(md|markdown|txt)$/i;
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set(['node_modules']);

const VERDICT_LABELS: Readonly<Record<string, string>> = {
    entered: 'entrou',
    repeats: 'repete o que já existe',
    contradicts: 'contradiz uma diretriz',
    blocked: 'ficou de fora (segredo ou instrução à IA)',
    refused: 'não passou numa conferência',
    unread: 'não deu para ler',
    already_there: 'já estava'
};

type ImportLevel = 'company' | 'area';
type PieceKind = 'context' | 'skill';

interface LocalImportFile {
    readonly fileName: string;
    readonly path: string;
    readonly sizeInBytes: number;
    readonly kind: PieceKind;
    readonly contentType: string;
}

interface IgnoredFile {
    readonly fileName: string;
    readonly reason: string;
}

interface Scanned {
    readonly files: readonly LocalImportFile[];
    readonly ignored: readonly IgnoredFile[];
}

interface Target {
    readonly level: ImportLevel;
    readonly scopeId?: string;
}

interface SummaryItem {
    readonly fileName: string;
    readonly kind: string;
    readonly name: string;
    readonly verdict: string;
    readonly reason: string | null;
    readonly cited: { readonly title: string; readonly level: string } | null;
}

interface RoundSummary {
    readonly entered: number;
    readonly repeated: number;
    readonly contradicted: number;
    readonly blocked: number;
    readonly refused: number;
    readonly unread: number;
    readonly alreadyThere: number;
    readonly items: readonly SummaryItem[];
}

interface RoundFile {
    readonly id: string;
    readonly fileName: string;
    readonly upload: { readonly url: string } | null;
}

interface Round {
    readonly id: string;
    readonly level: string;
    readonly status: string;
    readonly stopReason: string | null;
    readonly files: readonly RoundFile[];
    readonly summary: RoundSummary;
}

function extensionOf(name: string): string {
    const dot: number = name.lastIndexOf('.');
    return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

function classify(root: string, path: string, name: string): LocalImportFile | IgnoredFile {
    const fileName: string = relative(root, path).split(sep).join('/');
    const contentType: string | undefined = CONTENT_TYPES[extensionOf(name)];
    const sizeInBytes: number = statSync(path).size;
    if (contentType === undefined) {
        return { fileName, reason: 'formato que o Nexo não lê' };
    }
    if (sizeInBytes === 0) {
        return { fileName, reason: 'arquivo vazio' };
    }
    if (sizeInBytes > MAX_FILE_BYTES) {
        return { fileName, reason: 'acima de 25 MB' };
    }
    return { fileName, path, sizeInBytes, contentType, kind: SKILL_FILE.test(name) ? 'skill' : 'context' };
}

interface Walked {
    readonly paths: readonly string[];
    readonly ignored: readonly IgnoredFile[];
}

function ignoredReason(entry: Dirent): string | null {
    if (entry.isSymbolicLink()) {
        return 'link simbólico';
    }
    if (entry.name.startsWith('.')) {
        return 'oculto';
    }
    return SKIPPED_DIRECTORIES.has(entry.name) ? 'pasta de dependências' : null;
}

function walk(root: string, directory: string): Walked {
    const paths: string[] = [];
    const ignored: IgnoredFile[] = [];
    const entries: Dirent[] = readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
        const path: string = join(directory, entry.name);
        const reason: string | null = ignoredReason(entry);
        if (reason !== null) {
            ignored.push({ fileName: relative(root, path).split(sep).join('/'), reason });
            continue;
        }
        if (entry.isDirectory()) {
            const inner: Walked = walk(root, path);
            paths.push(...inner.paths);
            ignored.push(...inner.ignored);
            continue;
        }
        if (entry.isFile()) {
            paths.push(path);
        }
    }
    return { paths, ignored };
}

function scan(root: string): Scanned {
    const walked: Walked = walk(root, root);
    const classified: readonly (LocalImportFile | IgnoredFile)[] = walked.paths.map((path: string) =>
        classify(root, path, path.slice(path.lastIndexOf(sep) + 1))
    );
    return {
        files: classified.filter((item): item is LocalImportFile => 'path' in item),
        ignored: [...walked.ignored, ...classified.filter((item): item is IgnoredFile => 'reason' in item)]
    };
}

function scanned(folder: string): Scanned {
    const root: string = resolve(folder);
    try {
        if (!statSync(root).isDirectory()) {
            throw new Error('not a directory');
        }
    } catch {
        throw usageError(`Não consegui ler a pasta ${folder}.`);
    }
    const result: Scanned = scan(root);
    if (result.files.length === 0) {
        throw usageError('Não há arquivos para importar nesta pasta.', 'O Nexo lê PDF, DOCX, PPTX, XLSX, MD e TXT (até 25 MB cada).');
    }
    const total: number = result.files.reduce((sum: number, file: LocalImportFile) => sum + file.sizeInBytes, 0);
    if (result.files.length > MAX_FILES || total > MAX_TOTAL_BYTES) {
        throw usageError(
            `O pacote tem ${String(result.files.length)} arquivos: o teto é ${String(MAX_FILES)} arquivos e 100 MB por rodada.`,
            'Importe por partes, uma subpasta de cada vez.'
        );
    }
    return result;
}

async function call(context: CliContext, options: BrainOptions, method: HttpMethod, path: string, body?: unknown): Promise<unknown> {
    const response: ApiResponse = await clientOf(context, sessionOf(context, options)).request({
        method,
        path,
        ...(body === undefined ? {} : { body })
    });
    return response.body;
}

async function areaChosen(context: CliContext, options: BrainOptions): Promise<string> {
    if (options.area !== undefined && options.area.trim() !== '') {
        return options.area;
    }
    if (!isInteractive(context)) {
        throw usageError('Falta --area <id> (o nível é a área).', 'Veja as áreas com `nexo brain areas`.');
    }
    const list: { readonly areas: readonly { readonly id: string; readonly name: string }[] } = (await call(
        context,
        options,
        'GET',
        '/v1/brain/areas'
    )) as { readonly areas: readonly { readonly id: string; readonly name: string }[] };
    if (list.areas.length === 0) {
        throw usageError('A empresa não tem áreas: importe no nível da empresa (--scope company).');
    }
    list.areas.forEach((area, index: number) => {
        printNotice(context, `  ${String(index + 1)}. ${area.name}`);
    });
    const answer: string = await ask(context, 'Qual área? (número) ');
    const chosen: { readonly id: string } | undefined = list.areas[Number(answer) - 1];
    if (chosen === undefined) {
        throw usageError(`Área "${answer}" não está na lista.`);
    }
    return chosen.id;
}

function scopeOf(options: BrainOptions): ImportLevel | undefined {
    const scope: string | undefined = options.scope?.trim().toLowerCase();
    if (scope === undefined || scope === 'company' || scope === 'area') {
        return scope;
    }
    throw usageError(`Nível "${scope}" não vale para o import: use company (empresa) ou area.`);
}

async function askedTarget(context: CliContext, options: BrainOptions): Promise<Target> {
    if (!isInteractive(context)) {
        throw usageError(
            'Diga em que nível o import vale: --scope company (a empresa toda) ou --scope area --area <id>.',
            'Veja as áreas com `nexo brain areas`.'
        );
    }
    const answer: string = (await ask(context, 'Importar para a empresa toda ou para uma área? (empresa/area) ')).toLowerCase();
    if (/^(e|empresa|company)$/.test(answer)) {
        return { level: 'company' };
    }
    if (/^(a|area|área)$/.test(answer)) {
        return { level: 'area', scopeId: await areaChosen(context, options) };
    }
    throw usageError(`Não entendi "${answer}": responda empresa ou area.`);
}

async function targetOf(context: CliContext, options: BrainOptions): Promise<Target> {
    const scope: ImportLevel | undefined = scopeOf(options);
    if (scope === 'company' && options.area !== undefined) {
        throw usageError('--area só vale com o nível area; tire --area ou use --scope area.');
    }
    if (scope === 'company') {
        return { level: 'company' };
    }
    if (scope === 'area' || options.area !== undefined) {
        return { level: 'area', scopeId: await areaChosen(context, options) };
    }
    return askedTarget(context, options);
}

function describeScan(context: CliContext, found: Scanned): void {
    const skills: number = found.files.filter((file: LocalImportFile) => file.kind === 'skill').length;
    printNotice(
        context,
        `${String(found.files.length)} arquivo(s) para mandar (${String(skills)} de skill, ${String(found.files.length - skills)} de contexto).`
    );
    for (const file of found.ignored) {
        printNotice(context, `Ignorado: ${file.fileName} (${file.reason}).`);
    }
}

async function openRound(context: CliContext, options: BrainOptions, target: Target, files: readonly LocalImportFile[]): Promise<Round> {
    const body: unknown = {
        level: target.level,
        ...(target.scopeId === undefined ? {} : { scopeId: target.scopeId }),
        files: files.map((file: LocalImportFile) => ({ fileName: file.fileName, sizeInBytes: file.sizeInBytes, kind: file.kind }))
    };
    return (await call(context, options, 'POST', IMPORTS_PATH, body)) as Round;
}

async function upload(context: CliContext, url: string, local: LocalImportFile): Promise<void> {
    let response: Response;
    try {
        response = await context.fetchFn(url, {
            method: 'PUT',
            headers: { 'content-type': local.contentType },
            body: new Uint8Array(readFileSync(local.path))
        });
    } catch (error: unknown) {
        throw new CliError(
            `Não consegui enviar ${local.fileName}: ${error instanceof Error ? error.message : String(error)}.`,
            EXIT_CODES.failure
        );
    }
    if (!response.ok) {
        throw new CliError(
            `Não consegui enviar ${local.fileName}: o link respondeu ${String(response.status)}.`,
            EXIT_CODES.failure,
            'O link vale 15 minutos; rode o comando de novo.'
        );
    }
}

async function sendFiles(context: CliContext, round: Round, files: readonly LocalImportFile[]): Promise<void> {
    if (round.files.length !== files.length) {
        throw new CliError(
            `A rodada voltou com ${String(round.files.length)} arquivo(s), e mandei ${String(files.length)}.`,
            EXIT_CODES.failure,
            'Rode o comando de novo.'
        );
    }
    for (const [index, target] of round.files.entries()) {
        const local: LocalImportFile | undefined = files[index];
        if (target.upload === null || local === undefined) {
            continue;
        }
        await upload(context, target.upload.url, local);
    }
}

function sleep(milliseconds: number): Promise<void> {
    return new Promise<void>((done: () => void) => {
        setTimeout(done, milliseconds);
    });
}

export function pollPause(raw: string | undefined): number {
    const value: number = Number(raw?.trim());
    return raw !== undefined && raw.trim() !== '' && Number.isFinite(value) && value >= 1 ? Math.floor(value) : DEFAULT_POLL_MS;
}

async function followRound(context: CliContext, options: BrainOptions, started: Round): Promise<Round> {
    const pause: number = pollPause(context.env.NEXO_IMPORT_POLL_MS);
    let round: Round = started;
    let waited: number = 0;
    while (round.status === 'running' || round.status === 'uploading') {
        if (waited >= MAX_WAIT_MS) {
            throw new CliError(
                'A rodada ainda está rodando depois de 30 minutos.',
                EXIT_CODES.failure,
                `Ela continua no Nexo; veja de novo com \`nexo api GET knowledge/imports/${round.id}\`.`
            );
        }
        await sleep(pause);
        waited += pause;
        round = (await call(context, options, 'GET', `${IMPORTS_PATH}/${encodeURIComponent(round.id)}`)) as Round;
    }
    return round;
}

function printSummary(context: CliContext, round: Round): void {
    const summary: RoundSummary = round.summary;
    printLine(
        context,
        `Entraram ${String(summary.entered)}; já estavam ${String(summary.alreadyThere)}; repetem ${String(summary.repeated)}; ` +
            `contradizem ${String(summary.contradicted)}; bloqueados ${String(summary.blocked)}; ` +
            `recusados ${String(summary.refused)}; não lidos ${String(summary.unread)}.`
    );
    for (const item of summary.items) {
        const label: string = VERDICT_LABELS[item.verdict] ?? item.verdict;
        const reason: string = item.reason === null ? '' : `, motivo: ${item.reason}`;
        const cited: string = item.cited === null ? '' : `, ${item.cited.title} (${item.cited.level})`;
        printLine(context, `  ${label}: ${item.fileName} - ${item.name}${reason}${cited}`);
    }
}

const NOT_ROLE_REFUSALS: readonly string[] = ['insufficient_scope', 'product_not_contracted', 'blocked_during_platform_visit'];

function forbiddenAsAdminOnly(error: unknown): unknown {
    if (
        error instanceof NexoApiError &&
        error.problem.status === 403 &&
        !NOT_ROLE_REFUSALS.some((suffix: string) => error.problem.type.endsWith(suffix))
    ) {
        return new CliError(
            'O import de projetos é só de admin.',
            EXIT_CODES.forbidden,
            'Peça a um admin da empresa para rodar este comando.'
        );
    }
    return error;
}

function printResult(context: CliContext, options: BrainOptions, round: Round): void {
    if (options.json === true) {
        printJson(context, round.summary);
        return;
    }
    printSummary(context, round);
}

export async function brainImport(context: CliContext, folder: string, options: BrainOptions): Promise<void> {
    const found: Scanned = scanned(folder);
    const target: Target = await targetOf(context, options);
    describeScan(context, found);
    const where: string = target.level === 'company' ? 'a empresa toda' : 'a área escolhida';
    if (!(await confirmed(context, options.yes, `Mandar ${String(found.files.length)} arquivo(s) para ${where}?`))) {
        return;
    }
    try {
        const opened: Round = await openRound(context, options, target, found.files);
        await sendFiles(context, opened, found.files);
        const started: Round = (await call(context, options, 'POST', `${IMPORTS_PATH}/${encodeURIComponent(opened.id)}/start`)) as Round;
        const round: Round = await followRound(context, options, started);
        printResult(context, options, round);
        if (round.status !== 'completed') {
            throw new CliError(
                `A rodada parou (${round.stopReason ?? 'sem motivo'}).`,
                EXIT_CODES.failure,
                'Rode o comando de novo na mesma pasta: o que já entrou aparece como "já estava" e o resto continua.'
            );
        }
    } catch (error: unknown) {
        throw forbiddenAsAdminOnly(error);
    }
}
