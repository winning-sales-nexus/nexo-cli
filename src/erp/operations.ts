import type { ApiResponse } from '../http/nexo-client.js';
import { MAX_OUTPUT_LINES, cut } from '../connect/runs.js';

export interface ErpOperation {
    readonly id: string;
    readonly conector: string;
    readonly key: string;
    readonly kind: 'query' | 'action';
    readonly label: string;
    readonly description: string;
    readonly args: readonly Readonly<Record<string, unknown>>[];
    readonly saida?: Readonly<Record<string, unknown>>;
    /** Campos que o `/v1` ainda pode trazer (guia, exemplo, notas): sem eles, o comando segue. */
    readonly guide?: unknown;
    readonly example?: unknown;
    readonly notes?: unknown;
}

export interface ErpCatalog {
    readonly total: number;
    readonly mostrando: number;
    readonly operacoes: readonly ErpOperation[];
    readonly aviso?: string;
}

export interface ErpQueryAnswer {
    readonly id: string;
    readonly saida: Readonly<Record<string, unknown>>;
    readonly emCache: boolean;
}

export interface ErpPlannedWrite {
    readonly metodo: string;
    readonly host: string;
    readonly url: string;
    readonly operacao?: string;
    readonly corpo: string | null;
}

export interface ErpPreview {
    readonly id: string;
    readonly acao: string;
    readonly conector: string;
    readonly escritas: readonly ErpPlannedWrite[];
    readonly saidaDoEnsaio: Readonly<Record<string, unknown>>;
    readonly aviso?: string;
    readonly confirmation?: { readonly token: string; readonly expiresAt: string };
}

export interface ErpApplied {
    readonly id: string;
    readonly saida: Readonly<Record<string, unknown>> | null;
    readonly repetida: boolean;
    readonly situacao: string;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unexpected(what: string): Error {
    return new Error(`${what} em formato inesperado.`);
}

export function catalogOf(response: ApiResponse): ErpCatalog {
    const body: unknown = response.body;
    if (!isRecord(body) || !Array.isArray(body.operacoes)) {
        throw unexpected('Lista de operações');
    }
    return body as unknown as ErpCatalog;
}

export function queryOf(response: ApiResponse): ErpQueryAnswer {
    if (!isRecord(response.body) || !isRecord(response.body.saida)) {
        throw unexpected('Resposta da consulta');
    }
    return response.body as unknown as ErpQueryAnswer;
}

export function previewOf(response: ApiResponse): ErpPreview {
    if (!isRecord(response.body) || !Array.isArray(response.body.escritas)) {
        throw unexpected('Prévia da ação');
    }
    return response.body as unknown as ErpPreview;
}

export function appliedOf(response: ApiResponse): ErpApplied {
    if (!isRecord(response.body) || typeof response.body.repetida !== 'boolean') {
        throw unexpected('Resposta da ação');
    }
    return response.body as unknown as ErpApplied;
}

function argLine(arg: Readonly<Record<string, unknown>>): string {
    const key: string = typeof arg.key === 'string' ? arg.key : '?';
    const type: string = typeof arg.type === 'string' ? arg.type : '';
    return `${key}${type === '' ? '' : `:${type}`}${arg.required === true ? '*' : ''}`;
}

function extra(label: string, value: unknown): readonly string[] {
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) {
        return [];
    }
    const text: string = typeof value === 'string' ? value : JSON.stringify(value);
    return [`  ${label}: ${text}`];
}

export function operationLines(operation: ErpOperation): readonly string[] {
    const args: string = operation.args.length === 0 ? 'sem argumentos' : `args: ${operation.args.map(argLine).join(', ')}`;
    return [
        `${operation.id}  ${operation.kind === 'action' ? 'ação   ' : 'consulta'}  ${operation.label}  [${operation.conector}]`,
        `  chave ${operation.key}; ${args}`,
        ...extra('guia', operation.guide),
        ...extra('exemplo', operation.example),
        ...extra('notas', operation.notes)
    ];
}

export function outputLines(output: Readonly<Record<string, unknown>> | null): readonly string[] {
    if (output === null || Object.keys(output).length === 0) {
        return [];
    }
    const lines: readonly string[] = JSON.stringify(output, null, 2)
        .split('\n')
        .map((line: string) => `  ${line}`);
    return cut(lines, MAX_OUTPUT_LINES, 'linhas');
}

export function writeLines(writes: readonly ErpPlannedWrite[]): readonly string[] {
    return writes.flatMap((write: ErpPlannedWrite) => [
        `  - ${write.metodo} ${write.host}${write.url}${write.operacao === undefined ? '' : ` (${write.operacao})`}`,
        ...(write.corpo === null
            ? []
            : cut(
                  write.corpo.split('\n').map((line: string) => `      ${line}`),
                  5,
                  'linhas do corpo'
              ))
    ]);
}
