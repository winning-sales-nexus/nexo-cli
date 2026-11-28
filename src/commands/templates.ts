import { createReadStream, writeFileSync } from 'node:fs';
import { clientOf, printJson, printLine, printNotice, sessionOf } from '../context.js';
import type { CliContext, GlobalOptions } from '../context.js';
import { CliError, usageError } from '../errors.js';
import { EXIT_CODES } from '../exit-codes.types.js';
import type { ApiResponse, HttpMethod } from '../http/nexo-client.js';
import { confirmed } from '../input/confirm.js';
import { readAll } from '../input/read-input.js';

export interface TemplateOptions extends GlobalOptions {
    readonly channel?: string;
    readonly state?: string;
    readonly subjectType?: string;
    readonly template?: string;
    readonly input?: string;
    readonly out?: string;
    readonly html?: string;
    readonly name?: string;
    readonly subject?: string;
    readonly text?: string;
    readonly footer?: string;
    readonly category?: string;
    readonly header?: string;
    readonly record?: string;
    readonly blocks?: string;
    readonly structure?: boolean;
    readonly yes?: boolean;
}

type ChangeAction = 'criar_modelo' | 'mudar_modelo' | 'publicar_modelo';

interface TemplateDocument {
    readonly json: { readonly content?: readonly { readonly type?: string }[] };
}

interface TemplateContent {
    readonly subject: string | null;
    readonly body: string;
    readonly footer: string | null;
    readonly document: TemplateDocument | null;
}

interface TemplateRule {
    readonly flowId: string;
    readonly name: string;
    readonly status: string;
    readonly sendsAutomatically: boolean;
}

interface Template {
    readonly id: string;
    readonly channel: string;
    readonly name: string;
    readonly state: string;
    readonly currentSeq: number;
    readonly fromKit: boolean;
    readonly content: TemplateContent;
    readonly rules: readonly TemplateRule[];
    readonly whatsapp?: { readonly metaStatus?: string | null; readonly reason?: string | null } | null;
    readonly updatedAt: string;
}

interface TemplateList {
    readonly items: readonly Template[];
}

interface Brand {
    readonly identidade: string;
    readonly falta: readonly string[];
    readonly onde: string | null;
    readonly caminho: string | null;
    readonly aviso?: string | null;
}

interface StructureBrand {
    readonly identity: 'complete' | 'partial' | 'absent';
    readonly missing: readonly string[];
    readonly moduleEnabled: boolean;
    readonly text: string | null;
}

interface EmailPreview {
    readonly subject: string | null;
    readonly body: string;
    readonly email: { readonly html: string; readonly text: string } | null;
}

interface TemplatePreview {
    readonly previews: readonly EmailPreview[];
}

interface Structured {
    readonly converted: boolean;
    readonly content: TemplateContent;
    readonly brand?: StructureBrand | null;
}

interface ChangeProblem {
    readonly nodeKey: string | null;
    readonly code: string;
    readonly reason: string;
}

interface ChangeCard {
    readonly title: string;
    readonly details: readonly string[];
    readonly change: {
        readonly action: string;
        readonly name: string;
        readonly problems: readonly ChangeProblem[];
        readonly changes: readonly string[];
        readonly previews: readonly { readonly subject: string | null; readonly html: string | null }[];
        readonly brand?: Brand | null;
    };
    readonly confirmation: { readonly token: string; readonly expiresAt: string };
}

interface ChangeApplied {
    readonly ok: boolean;
    readonly modelo: string;
    readonly situacao: string;
    readonly versao: number;
    readonly mensagem: string;
    readonly marca?: Brand | null;
    readonly formato?: string;
    readonly avisoFormato?: string;
    readonly meta?: readonly string[];
}

async function call(context: CliContext, options: GlobalOptions, method: HttpMethod, path: string, body?: unknown): Promise<unknown> {
    const response: ApiResponse = await clientOf(context, sessionOf(context, options)).request({
        method,
        path,
        ...(body === undefined ? {} : { body })
    });
    return response.body;
}

function templatePath(templateId: string): string {
    return `/v1/message-templates/${encodeURIComponent(templateId)}`;
}

async function jsonInput(context: CliContext, input: string): Promise<unknown> {
    const label: string = input === '-' ? 'stdin' : input;
    let text: string;
    try {
        text = await readAll(input === '-' ? context.stdin : createReadStream(input));
    } catch {
        throw usageError(`Não consegui ler ${label}.`);
    }
    try {
        return JSON.parse(text) as unknown;
    } catch {
        throw usageError(`O conteúdo de ${label} não é JSON válido.`);
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function saveFile(context: CliContext, path: string, text: string, label: string): void {
    try {
        writeFileSync(path, text);
    } catch {
        throw new CliError(`Não consegui gravar ${path}.`, EXIT_CODES.failure);
    }
    printNotice(context, `${label} gravado em ${path}.`);
}

function formatOf(content: TemplateContent): string {
    const nodes: readonly { readonly type?: string }[] | undefined = content.document?.json.content;
    if (content.document === null) {
        return 'texto simples';
    }
    return nodes !== undefined && nodes.length > 0 && nodes.every((node: { readonly type?: string }) => node.type === 'section')
        ? 'estruturado, com a marca'
        : 'blocos, formato antigo';
}

function printBrand(context: CliContext, brand: Brand | null | undefined): void {
    if (brand === null || brand === undefined) {
        return;
    }
    printLine(context, `Marca: identidade ${brand.identidade}${brand.falta.length === 0 ? '' : `, falta ${brand.falta.join(' e ')}`}`);
    if (brand.aviso !== null && brand.aviso !== undefined) {
        printLine(context, brand.aviso);
        return;
    }
    if (brand.onde !== null) {
        printLine(context, `Cadastre em ${brand.onde}${brand.caminho === null ? '' : ` (${brand.caminho})`}.`);
    }
}

const IDENTITY_LABELS: Readonly<Record<StructureBrand['identity'], string>> = {
    complete: 'completa',
    partial: 'parcial',
    absent: 'ausente'
};

function printStructureBrand(context: CliContext, brand: StructureBrand | null | undefined): void {
    if (brand === null || brand === undefined) {
        return;
    }
    printLine(
        context,
        `Marca: identidade ${IDENTITY_LABELS[brand.identity]}${brand.missing.length === 0 ? '' : `, falta ${brand.missing.join(' e ')}`}`
    );
    if (brand.text !== null) {
        printLine(context, brand.text);
    }
}

function row(template: Template): string {
    const kit: string = template.fromKit ? ' (kit)' : '';
    return `${template.id}  ${template.channel.padEnd(8)} ${template.state.padEnd(8)} v${String(template.currentSeq)}  ${template.name}${kit}`;
}

const META_LABELS: Readonly<Record<string, string>> = {
    in_review: 'em análise na Meta',
    approved: 'aprovado pela Meta',
    rejected: 'rejeitado pela Meta',
    paused: 'pausado pela Meta'
};

function metaLine(template: Template): string {
    const status: string | null | undefined = template.whatsapp?.metaStatus;
    if (status === null || status === undefined) {
        return '';
    }
    const reason: string | null | undefined = template.whatsapp?.reason;
    return ` [${META_LABELS[status] ?? status}${reason === null || reason === undefined || reason === '' ? '' : `: ${reason}`}]`;
}

export async function templatesList(context: CliContext, options: TemplateOptions): Promise<void> {
    const query: URLSearchParams = new URLSearchParams();
    for (const [key, value] of [
        ['channel', options.channel],
        ['state', options.state],
        ['subjectType', options.subjectType]
    ] as const) {
        if (value !== undefined) {
            query.set(key, value);
        }
    }
    const suffix: string = query.size === 0 ? '' : `?${query.toString()}`;
    const list: TemplateList = (await call(context, options, 'GET', `/v1/message-templates${suffix}`)) as TemplateList;
    if (options.json === true) {
        printJson(context, list);
        return;
    }
    if (list.items.length === 0) {
        printLine(context, 'Nenhum modelo de mensagem.');
        return;
    }
    list.items.forEach((template: Template) => {
        printLine(context, `${row(template)}${metaLine(template)}`);
    });
}

export async function templatesGet(context: CliContext, templateId: string, options: TemplateOptions): Promise<void> {
    const template: Template = (await call(context, options, 'GET', templatePath(templateId))) as Template;
    if (options.json === true) {
        printJson(context, template);
        return;
    }
    printLine(context, `${row(template)}${metaLine(template)}`);
    if (template.channel === 'email') {
        printLine(context, `Formato: ${formatOf(template.content)}`);
        printLine(context, `Assunto: ${template.content.subject ?? '—'}`);
    }
    if (template.content.body !== '') {
        printLine(context, template.content.body);
    }
    if (template.rules.length > 0) {
        printLine(context, 'Regras que usam o modelo:');
        template.rules.forEach((rule: TemplateRule) => {
            printLine(context, `  ${rule.name} (${rule.status})${rule.sendsAutomatically ? ', envia sozinha' : ''}`);
        });
    }
    printNotice(context, 'Para ler os blocos, use `nexo templates get <id> --json`.');
}

export async function templatesPreview(context: CliContext, templateId: string, options: TemplateOptions): Promise<void> {
    const preview: TemplatePreview = (await call(context, options, 'POST', `${templatePath(templateId)}/preview`, {})) as TemplatePreview;
    if (options.json === true) {
        printJson(context, preview);
        saveHtml(context, options, preview.previews[0]?.email?.html ?? null);
        return;
    }
    preview.previews.forEach((each: EmailPreview) => {
        printLine(context, `Assunto: ${each.subject ?? '—'}`);
        printLine(context, each.email === null ? each.body : each.email.text);
    });
    printNotice(context, 'A prévia usa só amostras fixas, nunca registros reais da empresa.');
    saveHtml(context, options, preview.previews[0]?.email?.html ?? null);
}

function saveHtml(context: CliContext, options: TemplateOptions, html: string | null): void {
    if (options.html !== undefined && html !== null) {
        saveFile(context, options.html, html, 'O HTML do e-mail');
    }
}

export async function templatesStructure(context: CliContext, options: TemplateOptions): Promise<void> {
    if ((options.template === undefined) === (options.input === undefined)) {
        throw usageError('Diga o conteúdo a estruturar com --template <id> ou com --input <arquivo>, só um dos dois.');
    }
    const content: unknown =
        options.template === undefined
            ? await jsonInput(context, options.input ?? '-')
            : ((await call(context, options, 'GET', templatePath(options.template))) as Template).content;
    const structured: Structured = (await call(context, options, 'POST', '/v1/message-templates/professional-structure', {
        content
    })) as Structured;
    if (options.out !== undefined) {
        saveFile(context, options.out, `${JSON.stringify(structured.content, null, 2)}\n`, 'O conteúdo estruturado');
    }
    if (options.json === true) {
        printJson(context, structured);
        return;
    }
    printLine(
        context,
        structured.converted ? 'O modelo foi colocado na estrutura nova da marca.' : 'O modelo já estava estruturado, ou vazio: nada mudou.'
    );
    printStructureBrand(context, structured.brand);
    printNotice(context, 'Nada foi gravado. Para gravar, use `nexo templates change`.');
}

function listOf(value: unknown, label: string): readonly unknown[] {
    const list: unknown = isRecord(value) ? value['blocos'] : value;
    if (!Array.isArray(list)) {
        throw usageError(`${label} pede a lista de blocos, ou um objeto com "blocos".`);
    }
    return list as readonly unknown[];
}

async function requestOf(
    context: CliContext,
    action: ChangeAction,
    templateId: string | undefined,
    options: TemplateOptions
): Promise<Record<string, unknown>> {
    const base: unknown = options.input === undefined ? {} : await jsonInput(context, options.input);
    if (!isRecord(base)) {
        throw usageError('O arquivo de --input pede um objeto JSON com os campos do pedido.');
    }
    const request: Record<string, unknown> = { ...base, acao: action };
    delete request['confirmationToken'];
    const fields: readonly (readonly [string, string | undefined])[] = [
        ['modeloId', templateId],
        ['canal', options.channel],
        ['nome', options.name],
        ['assunto', options.subject],
        ['texto', options.text],
        ['rodape', options.footer],
        ['categoria', options.category],
        ['cabecalho', options.header],
        ['registro', options.record]
    ];
    for (const [key, value] of fields) {
        if (value !== undefined) {
            request[key] = value;
        }
    }
    if (options.blocks !== undefined) {
        request['blocos'] = listOf(await jsonInput(context, options.blocks), '--blocks');
    }
    if (options.structure === false) {
        request['semEstrutura'] = true;
    }
    return request;
}

function printProblems(context: CliContext, problems: readonly ChangeProblem[]): void {
    problems.forEach((problem: ChangeProblem) => {
        printLine(context, `  - ${problem.nodeKey === null ? '' : `${problem.nodeKey}: `}${problem.reason}`);
    });
}

function printCard(context: CliContext, card: ChangeCard): void {
    printLine(context, card.title);
    card.details.forEach((line: string) => {
        printLine(context, `  ${line}`);
    });
    if (card.change.changes.length > 0) {
        printLine(context, 'O que sai e o que entra:');
        card.change.changes.forEach((line: string) => {
            printLine(context, `  ${line}`);
        });
    }
    const subject: string | null | undefined = card.change.previews[0]?.subject;
    if (subject !== undefined && subject !== null) {
        printLine(context, `Assunto da prévia: ${subject}`);
    }
    printBrand(context, card.change.brand);
}

function printApplied(context: CliContext, applied: ChangeApplied): void {
    printLine(context, `${applied.mensagem} (${applied.modelo}: ${applied.situacao}, versão ${String(applied.versao)})`);
    if (applied.avisoFormato !== undefined) {
        printLine(context, applied.avisoFormato);
    }
    printBrand(context, applied.marca);
    applied.meta?.forEach((line: string) => {
        printLine(context, `Meta: ${line}`);
    });
}

async function change(context: CliContext, action: ChangeAction, templateId: string | undefined, options: TemplateOptions): Promise<void> {
    const request: Record<string, unknown> = await requestOf(context, action, templateId, options);
    const card: ChangeCard = (await call(context, options, 'POST', '/v1/message-template-changes/preview', request)) as ChangeCard;
    saveHtml(context, options, card.change.previews[0]?.html ?? null);
    if (options.json !== true) {
        printCard(context, card);
    }
    if (card.change.problems.length > 0) {
        printLine(context, 'O Nexo não aceitou o pedido, corrija e rode de novo:');
        printProblems(context, card.change.problems);
        throw new CliError('Nada foi gravado: o pedido tem problemas.', EXIT_CODES.failure);
    }
    if (!(await confirmed(context, options.yes, 'Gravar assim?'))) {
        if (options.json === true) {
            printJson(context, card);
        }
        return;
    }
    const applied: ChangeApplied = (await call(context, options, 'POST', '/v1/message-template-changes/apply', {
        ...request,
        confirmationToken: card.confirmation.token
    })) as ChangeApplied;
    if (options.json === true) {
        printJson(context, applied);
        return;
    }
    printApplied(context, applied);
}

export async function templatesCreate(context: CliContext, options: TemplateOptions): Promise<void> {
    await change(context, 'criar_modelo', undefined, options);
}

export async function templatesChange(context: CliContext, templateId: string, options: TemplateOptions): Promise<void> {
    await change(context, 'mudar_modelo', templateId, options);
}

export async function templatesPublish(context: CliContext, templateId: string, options: TemplateOptions): Promise<void> {
    await change(context, 'publicar_modelo', templateId, options);
}
