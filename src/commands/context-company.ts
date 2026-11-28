import { clientOf, printJson, printLine, sessionOf } from '../context.js';
import type { CliContext, GlobalOptions } from '../context.js';
import { usageError } from '../errors.js';
import type { ApiResponse, HttpMethod } from '../http/nexo-client.js';
import { confirmed } from '../input/confirm.js';

export interface ContextOptions extends GlobalOptions {
    readonly valueJson?: boolean;
    readonly changeConfirmed?: boolean;
    readonly index?: string;
    readonly yes?: boolean;
}

type ContextAction = 'campo_mudar' | 'item_somar' | 'item_tirar' | 'bloco_confirmar';

interface ContextChange {
    readonly bloco: string;
    readonly acao: ContextAction;
    readonly campo?: string;
    readonly valor?: unknown;
    readonly item?: number | string;
    readonly confirmaBlocoConfirmado?: boolean;
}

interface ChangeCard {
    readonly title: string;
    readonly details: readonly string[];
    readonly confirmation: { readonly token: string; readonly expiresAt: string };
}

interface Canvas {
    readonly canvas: unknown;
    readonly version: number | null;
    readonly state: string;
}

interface ContextResponse {
    readonly canvases: Readonly<Record<string, Canvas>>;
}

/** O bloco da rota de escrita (português) e o canvas que GET /v1/company/context devolve. */
const BLOCKS: Readonly<Record<string, string>> = {
    empresa: 'company',
    icp: 'icp',
    persona: 'persona',
    proposta_de_valor: 'value-prop',
    posicionamento: 'positioning',
    oferta: 'offer',
    prova: 'proof'
};

const STATES: Readonly<Record<string, string>> = { confirmed: 'confirmado', draft: 'rascunho', empty: 'vazio' };

async function call(context: CliContext, options: GlobalOptions, method: HttpMethod, path: string, body?: unknown): Promise<unknown> {
    const response: ApiResponse = await clientOf(context, sessionOf(context, options)).request({
        method,
        path,
        ...(body === undefined ? {} : { body })
    });
    return response.body;
}

function blockOf(raw: string): string {
    const name: string = raw.trim().toLowerCase().replaceAll('-', '_');
    if (BLOCKS[name] === undefined) {
        throw usageError(`Bloco "${raw}" não existe: use ${Object.keys(BLOCKS).join(', ')}.`);
    }
    return name;
}

function valueOf(raw: string, options: ContextOptions): unknown {
    if (options.valueJson !== true) {
        return raw;
    }
    try {
        return JSON.parse(raw) as unknown;
    } catch {
        throw usageError('Com --value-json, o valor precisa ser JSON válido (texto vai entre aspas).');
    }
}

function itemOf(raw: string | undefined, index: string | undefined): number | string {
    if ((raw === undefined) === (index === undefined)) {
        throw usageError('Diga o item (o texto exato) ou --index <posição>, um dos dois.');
    }
    if (index === undefined) {
        return raw as string;
    }
    if (!/^\d+$/.test(index)) {
        throw usageError(`--index precisa de um número a partir de 0 (recebi "${index}").`);
    }
    return Number(index);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isField(value: Record<string, unknown>): boolean {
    return 'value' in value && 'origin' in value;
}

function leaves(node: unknown, path: string): readonly string[] {
    if (Array.isArray(node)) {
        return node.flatMap((child: unknown, index: number) => leaves(child, path === '' ? String(index) : `${path}.${String(index)}`));
    }
    if (!isRecord(node)) {
        return [];
    }
    if (isField(node)) {
        const value: unknown = node['value'];
        const text: string = typeof value === 'string' ? value : JSON.stringify(value);
        return [`  ${path} = ${text === '' ? '(vazio)' : text}  [${String(node['origin'])}]`];
    }
    return Object.entries(node).flatMap(([key, child]: [string, unknown]) => leaves(child, path === '' ? key : `${path}.${key}`));
}

function printBlock(context: CliContext, name: string, canvas: Canvas): void {
    const state: string = STATES[canvas.state] ?? canvas.state;
    printLine(context, `${name}: ${state}${canvas.version === null ? '' : `, versão ${String(canvas.version)}`}`);
    leaves(canvas.canvas, '').forEach((line: string) => {
        printLine(context, line);
    });
}

export async function contextShow(context: CliContext, rawBlock: string | undefined, options: ContextOptions): Promise<void> {
    const only: string | undefined = rawBlock === undefined ? undefined : blockOf(rawBlock);
    const body: ContextResponse = (await call(context, options, 'GET', '/v1/company/context')) as ContextResponse;
    const names: readonly string[] = only === undefined ? Object.keys(BLOCKS) : [only];
    if (options.json === true) {
        printJson(context, only === undefined ? body : { [only]: body.canvases[BLOCKS[only] as string] });
        return;
    }
    for (const name of names) {
        const canvas: Canvas | undefined = body.canvases[BLOCKS[name] as string];
        if (canvas !== undefined) {
            printBlock(context, name, canvas);
        }
    }
}

async function change(context: CliContext, request: ContextChange, options: ContextOptions): Promise<void> {
    const body: ContextChange = options.changeConfirmed === true ? { ...request, confirmaBlocoConfirmado: true } : request;
    const card: ChangeCard = (await call(context, options, 'POST', '/v1/company/context/changes/preview', body)) as ChangeCard;
    if (options.json !== true) {
        printLine(context, card.title);
        card.details.forEach((line: string) => {
            printLine(context, `  ${line}`);
        });
    }
    if (!(await confirmed(context, options.yes, 'Gravar assim?'))) {
        if (options.json === true) {
            printJson(context, card);
        }
        return;
    }
    const applied: { readonly message: string } = (await call(context, options, 'POST', '/v1/company/context/changes/apply', {
        ...body,
        confirmationToken: card.confirmation.token
    })) as { readonly message: string };
    if (options.json === true) {
        printJson(context, applied);
        return;
    }
    printLine(context, applied.message);
}

function fieldOf(raw: string): string {
    if (raw.trim() === '') {
        throw usageError('Diga o campo, com pontos e posições a partir de 0 (como `nexo context show` mostra).');
    }
    return raw.trim();
}

export async function contextSet(
    context: CliContext,
    rawBlock: string,
    field: string,
    value: string,
    options: ContextOptions
): Promise<void> {
    await change(
        context,
        { bloco: blockOf(rawBlock), acao: 'campo_mudar', campo: fieldOf(field), valor: valueOf(value, options) },
        options
    );
}

export async function contextAdd(
    context: CliContext,
    rawBlock: string,
    field: string,
    value: string,
    options: ContextOptions
): Promise<void> {
    await change(context, { bloco: blockOf(rawBlock), acao: 'item_somar', campo: fieldOf(field), valor: valueOf(value, options) }, options);
}

export async function contextRemove(
    context: CliContext,
    rawBlock: string,
    field: string,
    item: string | undefined,
    options: ContextOptions
): Promise<void> {
    await change(
        context,
        { bloco: blockOf(rawBlock), acao: 'item_tirar', campo: fieldOf(field), item: itemOf(item, options.index) },
        options
    );
}

export async function contextConfirm(context: CliContext, rawBlock: string, options: ContextOptions): Promise<void> {
    await change(context, { bloco: blockOf(rawBlock), acao: 'bloco_confirmar' }, options);
}
