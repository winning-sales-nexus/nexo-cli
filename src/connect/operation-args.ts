import { readFileSync } from 'node:fs';
import { usageError } from '../errors.js';

function parsed(text: string, origin: string): Record<string, unknown> {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        throw usageError(`${origin} não é JSON válido.`, 'Passe um objeto, como --args \'{"cnpj":"123"}\' ou --args @args.json.');
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw usageError(`${origin} precisa ser um objeto JSON.`);
    }
    return { ...value };
}

/** O valor de `--args`: um JSON na linha, ou `@arquivo`. Recusa antes de chamar o Nexo. */
export function readArgs(raw: string): Record<string, unknown> {
    if (!raw.startsWith('@')) {
        return parsed(raw, '--args');
    }
    const path: string = raw.slice(1);
    let text: string;
    try {
        text = readFileSync(path, 'utf8');
    } catch {
        throw usageError(`Não consegui ler ${path}.`);
    }
    return parsed(text, path);
}

/** A chamada de exemplo de um webhook, como o ensaio a recebe em `ctx.input`. */
export interface WebhookCall {
    readonly body: string;
    readonly contentType: string;
    readonly headers?: Record<string, string>;
    readonly query?: Record<string, string>;
}

function stringMap(value: unknown, field: string, path: string): Record<string, string> | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw usageError(`${path}: "${field}" precisa ser um objeto de textos.`);
    }
    const entries: [string, unknown][] = Object.entries(value);
    if (entries.some(([, item]: [string, unknown]) => typeof item !== 'string')) {
        throw usageError(`${path}: "${field}" precisa ter só valores em texto.`);
    }
    return Object.fromEntries(entries) as Record<string, string>;
}

/** O arquivo de `--input`: um JSON `{ body, contentType, headers?, query? }`. Recusa antes de chamar o Nexo. */
export function readWebhookCall(path: string): WebhookCall {
    let text: string;
    try {
        text = readFileSync(path, 'utf8');
    } catch {
        throw usageError(`Não consegui ler ${path}.`);
    }
    const file: Record<string, unknown> = parsed(text, path);
    if (typeof file.body !== 'string') {
        throw usageError(
            `${path}: "body" precisa ser o texto cru da chamada.`,
            'Para JSON, ponha o JSON dentro de um texto: "body": "{\\"nome\\":\\"Ana\\"}".'
        );
    }
    if (typeof file.contentType !== 'string' || file.contentType === '') {
        throw usageError(
            `${path}: falta "contentType".`,
            'Ex.: application/json, application/x-www-form-urlencoded, application/xml ou text/plain.'
        );
    }
    const headers: Record<string, string> | undefined = stringMap(file.headers, 'headers', path);
    const query: Record<string, string> | undefined = stringMap(file.query, 'query', path);
    return {
        body: file.body,
        contentType: file.contentType,
        ...(headers === undefined ? {} : { headers }),
        ...(query === undefined ? {} : { query })
    };
}
