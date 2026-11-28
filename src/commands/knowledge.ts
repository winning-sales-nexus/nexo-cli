import { clientOf, printJson, printLine, printNotice, sessionOf } from '../context.js';
import type { CliContext, GlobalOptions } from '../context.js';
import { usageError } from '../errors.js';
import type { ApiResponse, HttpMethod } from '../http/nexo-client.js';
import { confirmed } from '../input/confirm.js';

export const RULE_SUBJECTS: readonly string[] = [
    'discount',
    'minimum_price',
    'deadline',
    'payment_terms',
    'integration',
    'scope',
    'implementation'
];

export const RESOLVE_ACTIONS: readonly string[] = ['choose', 'approve', 'use', 'rewrite', 'discard'];

export const ITEM_TYPES: readonly string[] = ['rule', 'practice', 'product_fact', 'price', 'proof', 'standard'];

const MAX_MOVE: number = 100;

export interface KnowledgeOptions extends GlobalOptions {
    readonly theme?: string;
    readonly type?: string;
    readonly text?: string;
    readonly subject?: string;
    readonly condition?: string;
    readonly limit?: string;
    readonly exception?: string;
    readonly approver?: string;
    readonly action?: string;
    readonly needsYou?: boolean;
    readonly page?: string;
    readonly pageSize?: string;
    readonly yes?: boolean;
}

interface Theme {
    readonly id: string;
    readonly name: string;
    readonly itemCount: number;
    readonly materialCount: number;
    readonly webSourceCount: number;
}

interface Item {
    readonly id: string;
    readonly type: string;
    readonly text: string;
    readonly status: string;
    readonly themeId?: string;
    readonly theme?: { readonly id: string; readonly name: string };
}

interface ItemPage {
    readonly data: readonly Item[];
    readonly pagination: { readonly page: number; readonly totalPages: number; readonly totalRecords: number };
}

async function call(
    context: CliContext,
    options: GlobalOptions,
    method: HttpMethod,
    path: string,
    extra: { readonly query?: Readonly<Record<string, string>>; readonly body?: unknown } = {}
): Promise<unknown> {
    const response: ApiResponse = await clientOf(context, sessionOf(context, options)).request({ method, path, ...extra });
    return response.body;
}

function typeOf(raw: string | undefined): string | undefined {
    if (raw === undefined) {
        return undefined;
    }
    if (!ITEM_TYPES.includes(raw)) {
        throw usageError(`Tipo "${raw}" não existe: use ${ITEM_TYPES.join(', ')}.`);
    }
    return raw;
}

/** The structured fields of a rule, as the server wants them: the subject plus four nullable strings. */
function ruleOf(options: KnowledgeOptions): Record<string, string | null> | undefined {
    const given: readonly (string | undefined)[] = [options.subject, options.condition, options.limit, options.exception, options.approver];
    if (given.every((value: string | undefined) => value === undefined)) {
        return undefined;
    }
    if (options.subject === undefined || !RULE_SUBJECTS.includes(options.subject)) {
        throw usageError(
            `Os campos da regra pedem --subject: ${RULE_SUBJECTS.join(', ')}.`,
            '--condition, --limit, --exception e --approver são opcionais; numa edição, o que não vier fica vazio.'
        );
    }
    return {
        subject: options.subject,
        condition: options.condition ?? null,
        limit: options.limit ?? null,
        exception: options.exception ?? null,
        approver: options.approver ?? null
    };
}

function themeName(item: Item): string {
    return item.theme?.name ?? item.themeId ?? '-';
}

function printItem(context: CliContext, item: Item): void {
    printLine(context, `${item.id}  ${item.type.padEnd(12)} [${item.status}]  tema: ${themeName(item)}`);
    printLine(context, `  ${item.text}`);
}

const MAX_LIST_PAGES: number = 200;

async function listPage(context: CliContext, options: KnowledgeOptions, query: Record<string, string>): Promise<ItemPage> {
    return (await call(context, options, 'GET', '/v1/knowledge/items', { query })) as ItemPage;
}

function inTheme(items: readonly Item[], themeId: string): readonly Item[] {
    return items.filter((item: Item) => (item.themeId ?? item.theme?.id) === themeId);
}

/** Walks every page and keeps the items of one theme: the API has no theme filter on the list. */
async function itemsOfTheme(
    context: CliContext,
    options: KnowledgeOptions,
    base: Record<string, string>,
    themeId: string
): Promise<ItemPage> {
    const kept: Item[] = [];
    let page: number = 1;
    let totalPages: number = 1;
    while (page <= totalPages && page <= MAX_LIST_PAGES) {
        const result: ItemPage = await listPage(context, options, { ...base, page: String(page), pageSize: '100' });
        kept.push(...inTheme(result.data, themeId));
        totalPages = result.pagination.totalPages;
        page += 1;
    }
    return { data: kept, pagination: { page: 1, totalPages: 1, totalRecords: kept.length } };
}

function listQueryOf(options: KnowledgeOptions): Record<string, string> {
    const query: Record<string, string> = {};
    const type: string | undefined = typeOf(options.type);
    if (type !== undefined) {
        query.type = type;
    }
    if (options.needsYou === true) {
        query.needsYou = 'true';
    }
    if (options.theme === undefined) {
        if (options.page !== undefined) {
            query.page = options.page;
        }
        if (options.pageSize !== undefined) {
            query.pageSize = options.pageSize;
        }
    }
    return query;
}

export async function itemsList(context: CliContext, options: KnowledgeOptions): Promise<void> {
    const query: Record<string, string> = listQueryOf(options);
    const page: ItemPage =
        options.theme === undefined ? await listPage(context, options, query) : await itemsOfTheme(context, options, query, options.theme);
    if (options.json === true) {
        printJson(context, page);
        return;
    }
    if (page.data.length === 0) {
        printLine(context, 'Nenhum item.');
        return;
    }
    page.data.forEach((item: Item) => {
        printItem(context, item);
    });
    if (page.pagination.page < page.pagination.totalPages) {
        printNotice(context, `Página ${String(page.pagination.page)} de ${String(page.pagination.totalPages)}: veja a próxima com --page.`);
    }
}

export async function itemsCreate(context: CliContext, options: KnowledgeOptions): Promise<void> {
    const type: string | undefined = typeOf(options.type);
    if (type === undefined || options.text === undefined || options.text.trim() === '') {
        throw usageError('Diga o tipo (--type) e o texto (--text) do item.', `Tipos: ${ITEM_TYPES.join(', ')}.`);
    }
    const rule: Record<string, string | null> | undefined = ruleOf(options);
    if (type === 'rule' && rule === undefined) {
        throw usageError('Item do tipo rule pede --subject (e, se quiser, --condition, --limit, --exception, --approver).');
    }
    const body: Record<string, unknown> = { type, text: options.text };
    if (rule !== undefined) {
        body.rule = rule;
    }
    if (options.theme !== undefined) {
        body.themeId = options.theme;
    }
    const item: Item = (await call(context, options, 'POST', '/v1/knowledge/items', { body })) as Item;
    if (options.json === true) {
        printJson(context, item);
        return;
    }
    printLine(context, 'Item criado; já está em uso.');
    printItem(context, item);
}

export async function itemsEdit(context: CliContext, itemId: string, options: KnowledgeOptions): Promise<void> {
    const body: Record<string, unknown> = {};
    const type: string | undefined = typeOf(options.type);
    if (type !== undefined) {
        body.type = type;
    }
    if (options.theme !== undefined) {
        body.themeId = options.theme;
    }
    if (options.text !== undefined) {
        body.text = options.text;
    }
    const rule: Record<string, string | null> | undefined = ruleOf(options);
    if (rule !== undefined) {
        body.rule = rule;
    }
    if (Object.keys(body).length === 0) {
        throw usageError('Nenhuma mudança: use --text, --type, --theme ou os campos da regra (--subject ...).');
    }
    const item: Item = (await call(context, options, 'PATCH', `/v1/knowledge/items/${encodeURIComponent(itemId)}`, { body })) as Item;
    if (options.json === true) {
        printJson(context, item);
        return;
    }
    printLine(context, 'Item editado.');
    printItem(context, item);
}

export async function itemsMove(context: CliContext, itemIds: readonly string[], options: KnowledgeOptions): Promise<void> {
    if (options.theme === undefined) {
        throw usageError('Diga o tema de destino com --theme <id> (`nexo knowledge themes list`).');
    }
    if (itemIds.length === 0 || itemIds.length > MAX_MOVE) {
        throw usageError(`Passe de 1 a ${String(MAX_MOVE)} ids de item.`);
    }
    const result: { readonly moved: number; readonly themeId: string } = (await call(context, options, 'POST', '/v1/knowledge/items/move', {
        body: { itemIds, themeId: options.theme }
    })) as { readonly moved: number; readonly themeId: string };
    if (options.json === true) {
        printJson(context, result);
        return;
    }
    printLine(context, `${String(result.moved)} item(ns) no tema ${result.themeId}.`);
}

export async function themesList(context: CliContext, options: KnowledgeOptions): Promise<void> {
    const list: { readonly data: readonly Theme[] } = (await call(context, options, 'GET', '/v1/knowledge/themes')) as {
        readonly data: readonly Theme[];
    };
    if (options.json === true) {
        printJson(context, list);
        return;
    }
    if (list.data.length === 0) {
        printLine(context, 'Nenhum tema.');
    }
    for (const theme of list.data) {
        printLine(
            context,
            `${theme.id}  ${theme.name}  (${String(theme.itemCount)} itens, ${String(theme.materialCount)} arquivos, ${String(theme.webSourceCount)} fontes web)`
        );
    }
}

function nameOf(name: string): string {
    if (name.trim() === '') {
        throw usageError('O nome do tema não pode ser vazio.');
    }
    return name;
}

export async function themesCreate(context: CliContext, name: string, options: KnowledgeOptions): Promise<void> {
    const theme: Theme = (await call(context, options, 'POST', '/v1/knowledge/themes', { body: { name: nameOf(name) } })) as Theme;
    if (options.json === true) {
        printJson(context, theme);
        return;
    }
    printLine(context, `Tema criado: ${theme.id}  ${theme.name}`);
}

export async function themesRename(context: CliContext, themeId: string, name: string, options: KnowledgeOptions): Promise<void> {
    const theme: Theme = (await call(context, options, 'PATCH', `/v1/knowledge/themes/${encodeURIComponent(themeId)}`, {
        body: { name: nameOf(name) }
    })) as Theme;
    if (options.json === true) {
        printJson(context, theme);
        return;
    }
    printLine(context, `Tema renomeado: ${theme.id}  ${theme.name}`);
}

export async function themesRemove(context: CliContext, themeId: string, options: KnowledgeOptions): Promise<void> {
    if (!(await confirmed(context, options.yes, `Apagar o tema ${themeId}? Só passa se ele estiver vazio.`))) {
        return;
    }
    await call(context, options, 'DELETE', `/v1/knowledge/themes/${encodeURIComponent(themeId)}`);
    printLine(context, 'Tema apagado.');
}

function itemPath(itemId: string, suffix: string = ''): string {
    return `/v1/knowledge/items/${encodeURIComponent(itemId)}${suffix}`;
}

export async function itemsSwitch(context: CliContext, itemId: string, on: boolean, options: KnowledgeOptions): Promise<void> {
    const item: Item = (await call(context, options, 'POST', itemPath(itemId, on ? '/enable' : '/disable'))) as Item;
    if (options.json === true) {
        printJson(context, item);
        return;
    }
    printLine(context, on ? 'Item ligado: de volta em uso.' : 'Item desligado: fora de uso, sem apagar.');
    printItem(context, item);
}

export async function itemsResolve(context: CliContext, itemId: string, options: KnowledgeOptions): Promise<void> {
    const action: string | undefined = options.action;
    if (action === undefined || !RESOLVE_ACTIONS.includes(action)) {
        throw usageError(`Diga a ação com --action: ${RESOLVE_ACTIONS.join(', ')}.`);
    }
    if (action === 'rewrite' && (options.text === undefined || options.text.trim() === '')) {
        throw usageError('A ação rewrite pede o texto novo com --text.');
    }
    if (action === 'discard' && !(await confirmed(context, options.yes, `Descartar o item ${itemId}? Ele sai da Base de vez.`))) {
        return;
    }
    const body: Record<string, unknown> = { action };
    if (action === 'rewrite') {
        body.text = options.text;
    }
    const result: unknown = await call(context, options, 'POST', itemPath(itemId, '/resolve'), { body });
    if (options.json === true) {
        printJson(context, result);
        return;
    }
    printLine(context, `Pendência resolvida (${action}).`);
}

export async function itemsRemove(context: CliContext, itemId: string, options: KnowledgeOptions): Promise<void> {
    if (
        !(await confirmed(
            context,
            options.yes,
            `Remover o item ${itemId}? Ele não volta com o mesmo material (para tirar de uso, use off).`
        ))
    ) {
        return;
    }
    await call(context, options, 'DELETE', itemPath(itemId));
    printLine(context, 'Item removido.');
}
