import { createReadStream } from 'node:fs';
import { clientOf, printJson, printLine, sessionOf } from '../context.js';
import type { CliContext, GlobalOptions } from '../context.js';
import { usageError } from '../errors.js';
import type { ApiResponse, HttpMethod } from '../http/nexo-client.js';
import { readAll } from '../input/read-input.js';

export interface ApiOptions extends GlobalOptions {
    readonly method?: string;
    readonly rawField?: readonly string[];
    readonly field?: readonly string[];
    readonly input?: string;
}

const METHODS: ReadonlySet<string> = new Set<string>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

function isMethod(value: string): value is HttpMethod {
    return METHODS.has(value);
}

function splitPair(pair: string): readonly [string, string] {
    const index: number = pair.indexOf('=');
    if (index <= 0) {
        throw usageError(`Campo sem "=": ${pair}.`, 'Use chave=valor.');
    }
    return [pair.slice(0, index), pair.slice(index + 1)];
}

export function typedValue(raw: string): unknown {
    try {
        return JSON.parse(raw) as unknown;
    } catch {
        return raw;
    }
}

export function fieldsOf(options: ApiOptions): Record<string, unknown> {
    const fields: Record<string, unknown> = {};
    for (const pair of options.rawField ?? []) {
        const [key, value] = splitPair(pair);
        fields[key] = value;
    }
    for (const pair of options.field ?? []) {
        const [key, value] = splitPair(pair);
        fields[key] = typedValue(value);
    }
    return fields;
}

async function inputBody(context: CliContext, input: string): Promise<unknown> {
    const text: string = await readAll(input === '-' ? context.stdin : createReadStream(input));
    try {
        return JSON.parse(text) as unknown;
    } catch {
        throw usageError(`O conteúdo de ${input === '-' ? 'stdin' : input} não é JSON válido.`);
    }
}

export function methodOf(options: ApiOptions, hasPayload: boolean): HttpMethod {
    const method: string = (options.method ?? (hasPayload ? 'POST' : 'GET')).toUpperCase();
    if (!isMethod(method)) {
        throw usageError(`Método desconhecido: ${method}.`, 'Use GET, POST, PUT, PATCH ou DELETE.');
    }
    return method;
}

function queryOf(fields: Record<string, unknown>): Record<string, string> {
    return Object.fromEntries(
        Object.entries(fields).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)])
    );
}

export async function api(context: CliContext, path: string, options: ApiOptions): Promise<void> {
    const fields: Record<string, unknown> = fieldsOf(options);
    const hasFields: boolean = Object.keys(fields).length > 0;
    const method: HttpMethod = methodOf(options, hasFields || options.input !== undefined);
    const readsOnly: boolean = method === 'GET' || method === 'DELETE';
    const body: unknown =
        options.input === undefined ? (hasFields && !readsOnly ? fields : undefined) : await inputBody(context, options.input);
    const response: ApiResponse = await clientOf(context, sessionOf(context, options)).request({
        method,
        path,
        ...(readsOnly && hasFields ? { query: queryOf(fields) } : {}),
        ...(body === undefined ? {} : { body })
    });
    if (typeof response.body === 'string') {
        printLine(context, response.body);
        return;
    }
    printJson(context, response.body);
}
