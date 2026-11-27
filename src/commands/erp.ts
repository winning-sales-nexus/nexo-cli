import { clientOf, printJson, printLine, printNotice, sessionOf } from '../context.js';
import type { CliContext, GlobalOptions } from '../context.js';
import type { Session } from '../config/session.js';
import { usageError } from '../errors.js';
import type { ApiRequest, ApiResponse } from '../http/nexo-client.js';
import { ask, requestLocalChange } from '../connect/changes.js';
import { readArgs } from '../connect/operation-args.js';
import { appliedOf, catalogLines, catalogOf, outputLines, previewOf, queryOf, writeLines } from '../erp/operations.js';
import type { ErpApplied, ErpCatalog, ErpOperation, ErpPreview, ErpQueryAnswer } from '../erp/operations.js';

export interface ErpOptions extends GlobalOptions {
    readonly args?: string;
    readonly confirm?: string | boolean;
    readonly field?: string;
    readonly remove?: boolean;
    readonly yes?: boolean;
}

const NOT_FOUND_HINT: string = 'Veja as operações que você alcança com `nexo erp list`.';

async function catalog(context: CliContext, session: Session, search: string | undefined): Promise<ErpCatalog> {
    const response: ApiResponse = await clientOf(context, session).request({
        method: 'GET',
        path: '/v1/erp/operations',
        ...(search === undefined ? {} : { query: { search } })
    });
    return catalogOf(response);
}

/** O id (`<conector>:<chave>`) vai direto; uma chave solta é resolvida pela lista. */
export async function resolveOperation(context: CliContext, session: Session, target: string): Promise<string> {
    if (target.includes(':')) {
        return target;
    }
    const found: readonly ErpOperation[] = (await catalog(context, session, target)).operacoes.filter(
        (operation: ErpOperation) => operation.key === target
    );
    if (found.length === 0) {
        throw usageError(`Não achei a operação ${target} entre as que você pode usar.`, NOT_FOUND_HINT);
    }
    if (found.length > 1) {
        throw usageError(
            `A chave ${target} existe em mais de um conector: ${found.map((operation: ErpOperation) => operation.id).join(', ')}.`,
            'Use o id completo (<conector>:<chave>).'
        );
    }
    return found[0]?.id ?? target;
}

export async function erpList(context: CliContext, search: string | undefined, options: ErpOptions): Promise<void> {
    const result: ErpCatalog = await catalog(context, sessionOf(context, options), search);
    if (options.json === true) {
        printJson(context, result);
        return;
    }
    if (result.operacoes.length === 0) {
        printLine(context, result.aviso ?? 'Nenhuma operação de ERP para você.');
        return;
    }
    for (const line of catalogLines(result)) {
        printLine(context, line);
    }
    if (result.total > result.mostrando) {
        printLine(
            context,
            `Mostrando ${String(result.mostrando)} de ${String(result.total)}${result.aviso === undefined ? '' : `. ${result.aviso}`}`
        );
    }
}

function argsOf(options: ErpOptions): Record<string, unknown> {
    return options.args === undefined ? {} : readArgs(options.args);
}

export async function erpQuery(context: CliContext, target: string, options: ErpOptions): Promise<void> {
    const args: Record<string, unknown> = argsOf(options);
    const session: Session = sessionOf(context, options);
    const id: string = await resolveOperation(context, session, target);
    const response: ApiResponse = await clientOf(context, session).request({
        method: 'POST',
        path: `/v1/erp/operations/${encodeURIComponent(id)}/query`,
        body: { args }
    });
    if (options.json === true) {
        printJson(context, response.body);
        return;
    }
    const answer: ErpQueryAnswer = queryOf(response);
    printLine(context, `Resultado de ${answer.id}${answer.emCache ? ' (da memória do conector, sem ir ao outro sistema)' : ''}:`);
    for (const line of outputLines(answer.saida)) {
        printLine(context, line);
    }
}

function shellQuote(text: string): string {
    return `'${text.replaceAll("'", `'\\''`)}'`;
}

function showPreview(context: CliContext, preview: ErpPreview): void {
    printLine(context, `${preview.acao} (${preview.conector}) escreveria no outro sistema:`);
    const writes: readonly string[] = writeLines(preview.escritas);
    if (writes.length === 0) {
        printLine(context, '  (nada)');
    }
    for (const line of writes) {
        printLine(context, line);
    }
    const output: readonly string[] = outputLines(preview.saidaDoEnsaio);
    if (output.length > 0) {
        printLine(context, 'Resultado do ensaio:');
        for (const line of output) {
            printLine(context, line);
        }
    }
    if (preview.aviso !== undefined) {
        printLine(context, preview.aviso);
    }
}

async function applyAction(
    context: CliContext,
    session: Session,
    request: { readonly id: string; readonly args: Record<string, unknown>; readonly token: string; readonly json: boolean }
): Promise<void> {
    const response: ApiResponse = await clientOf(context, session).request({
        method: 'POST',
        path: `/v1/erp/operations/${encodeURIComponent(request.id)}/apply`,
        body: { args: request.args, confirmationToken: request.token }
    });
    if (request.json) {
        printJson(context, response.body);
        return;
    }
    const applied: ErpApplied = appliedOf(response);
    printLine(
        context,
        applied.repetida
            ? 'Esta confirmação já tinha sido aplicada: nada foi gravado de novo. Esta é a resposta da primeira vez.'
            : 'Feito.'
    );
    printLine(context, `Situação: ${applied.situacao}`);
    for (const line of outputLines(applied.saida)) {
        printLine(context, line);
    }
}

async function decideAction(
    context: CliContext,
    session: Session,
    request: { readonly id: string; readonly args: Record<string, unknown>; readonly preview: ErpPreview }
): Promise<void> {
    showPreview(context, request.preview);
    const token: string | undefined = request.preview.confirmation?.token;
    if (token === undefined) {
        printNotice(context, 'Esta ação não pode gravar agora: nada foi aplicado.');
        return;
    }
    if (context.stdin.isTTY !== true) {
        printNotice(context, 'Mostre isto à pessoa. Depois do sim dela, aplique uma vez:');
        printNotice(context, `  nexo erp action ${request.id} --args ${shellQuote(JSON.stringify(request.args))} --confirm ${token}`);
        return;
    }
    if (await ask(context, 'Confirma? (s/N) ')) {
        await applyAction(context, session, { id: request.id, args: request.args, token, json: false });
        return;
    }
    printNotice(context, 'Nada mudou.');
}

/** `-y` não existe aqui de propósito: gravar no sistema do cliente pede o sim da pessoa, ou o token da prévia que ela viu. */
export async function erpAction(context: CliContext, target: string, options: ErpOptions): Promise<void> {
    const args: Record<string, unknown> = argsOf(options);
    const session: Session = sessionOf(context, options);
    const id: string = await resolveOperation(context, session, target);
    if (typeof options.confirm === 'string') {
        await applyAction(context, session, { id, args, token: options.confirm, json: options.json === true });
        return;
    }
    const response: ApiResponse = await clientOf(context, session).request({
        method: 'POST',
        path: `/v1/erp/operations/${encodeURIComponent(id)}/preview`,
        body: { args }
    });
    const preview: ErpPreview = previewOf(response);
    if (options.json === true) {
        printJson(context, response.body);
        return;
    }
    await decideAction(context, session, { id, args, preview });
}

const NOTE_MAX_CHARS: number = 500;

interface NoteView {
    readonly field: string | null;
    readonly text: string;
}

function noteBase(id: string): { readonly path: string; readonly key: string } {
    const split: number = id.indexOf(':');
    return {
        path: `/v1/connect/connectors/${id.slice(0, split)}/operations/${encodeURIComponent(id.slice(split + 1))}/notes`,
        key: id.slice(split + 1)
    };
}

async function currentNote(context: CliContext, session: Session, path: string, field: string | null): Promise<string | null> {
    const response: ApiResponse = await clientOf(context, session).request({ method: 'GET', path });
    const notes: unknown = (response.body as { notes?: unknown }).notes;
    const found: NoteView | undefined = (Array.isArray(notes) ? (notes as readonly NoteView[]) : []).find(
        (note: NoteView) => note.field === field
    );
    return found?.text ?? null;
}

function noteCommand(id: string, options: ErpOptions, text: string | undefined): string {
    const field: string = options.field === undefined ? '' : ` --field ${shellQuote(options.field)}`;
    return `nexo erp note ${id}${field} ${text === undefined ? '--remove' : shellQuote(text)}`;
}

function checkNoteInput(text: string | undefined, options: ErpOptions): void {
    if (options.remove === true && text !== undefined) {
        throw usageError('Use o texto ou --remove, não os dois.');
    }
    if (options.remove !== true && (text === undefined || text.trim() === '')) {
        throw usageError('Falta o texto da nota.', 'Escreva `nexo erp note <operação> "<texto>"`, ou apague com --remove.');
    }
    if (text !== undefined && text.trim().length > NOTE_MAX_CHARS) {
        throw usageError(`A nota passa de ${String(NOTE_MAX_CHARS)} caracteres.`, 'Encurte o texto.');
    }
}

function noteRequest(path: string, field: string | null, text: string | null): ApiRequest {
    return text === null
        ? { method: 'DELETE', path, ...(field === null ? {} : { query: { field } }) }
        : { method: 'PUT', path, body: { ...(field === null ? {} : { field }), text } };
}

function unchangedMessage(where: string, after: string | null): string {
    return after === null ? `Não há nota em ${where} para apagar.` : `A nota de ${where} já tem este texto.`;
}

/** A nota é da empresa, mas não é do outro sistema: o sim pode vir de `-y`, como nas mudanças do `nexo connect`. */
export async function erpNote(context: CliContext, target: string, text: string | undefined, options: ErpOptions): Promise<void> {
    checkNoteInput(text, options);
    const session: Session = sessionOf(context, options);
    const id: string = await resolveOperation(context, session, target);
    const { path, key } = noteBase(id);
    const field: string | null = options.field ?? null;
    const before: string | null = await currentNote(context, session, path, field);
    const after: string | null = options.remove === true ? null : (text?.trim() ?? null);
    const where: string = `${key}${field === null ? '' : ` / ${field}`}`;
    if (before === after) {
        printLine(context, unchangedMessage(where, after));
        return;
    }
    await requestLocalChange(context, {
        preview: {
            title: `Nota da empresa em ${where}`,
            changes: [`Antes: ${before ?? '(sem nota)'}`, `Depois: ${after ?? '(sem nota)'}`]
        },
        command: noteCommand(id, options, after === null ? undefined : after),
        confirmed: options.confirm === true,
        yes: options.yes === true,
        json: options.json === true,
        apply: () => clientOf(context, session).request(noteRequest(path, field, after)),
        report: () => {
            printLine(context, after === null ? 'Nota apagada.' : 'Nota gravada.');
        }
    });
}
