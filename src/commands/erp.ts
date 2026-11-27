import { clientOf, printJson, printLine, printNotice, sessionOf } from '../context.js';
import type { CliContext, GlobalOptions } from '../context.js';
import type { Session } from '../config/session.js';
import { usageError } from '../errors.js';
import type { ApiResponse } from '../http/nexo-client.js';
import { ask } from '../connect/changes.js';
import { readArgs } from '../connect/operation-args.js';
import { appliedOf, catalogLines, catalogOf, outputLines, previewOf, queryOf, writeLines } from '../erp/operations.js';
import type { ErpApplied, ErpCatalog, ErpOperation, ErpPreview, ErpQueryAnswer } from '../erp/operations.js';

export interface ErpOptions extends GlobalOptions {
    readonly args?: string;
    readonly confirm?: string;
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
    if (options.confirm !== undefined) {
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
