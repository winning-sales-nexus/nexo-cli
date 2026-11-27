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
