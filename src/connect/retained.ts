import { readFileSync } from 'node:fs';
import { usageError } from '../errors.js';

export interface QuarantineRecord {
    readonly values: Readonly<Record<string, unknown>>;
    readonly properties: Readonly<Record<string, unknown>>;
}

export interface QuarantineItem {
    readonly id: string;
    readonly objectType: string;
    readonly record: QuarantineRecord;
    readonly reason: string;
    readonly errorCode: string;
    readonly attempts: number;
    readonly status: string;
    readonly runId: string;
}

export interface HeldWrite {
    readonly id: string;
    readonly runId: string;
    readonly status: string;
    readonly method: string;
    readonly url: string;
    readonly body: string | null;
    readonly failureNotice: string | null;
}

export interface ExternalWrites {
    readonly externalWrites: boolean;
    readonly confirmed: { readonly hosts: readonly string[] } | null;
    readonly needsConfirmation: boolean;
    readonly held: HeldWrite | null;
}

/** O corpo do `PATCH` da quarentena. */
export interface QuarantineFix {
    readonly values: Readonly<Record<string, unknown>>;
    readonly properties: Readonly<Record<string, unknown>>;
}

const PROPERTIES_PREFIX: string = 'properties.';

export function isQuarantineList(value: unknown): value is readonly QuarantineItem[] {
    return Array.isArray(value);
}

export function isExternalWrites(value: unknown): value is ExternalWrites {
    return typeof value === 'object' && value !== null && typeof (value as { externalWrites?: unknown }).externalWrites === 'boolean';
}

function isProperty(key: string): boolean {
    return key.startsWith(PROPERTIES_PREFIX) && key.length > PROPERTIES_PREFIX.length;
}

function scalar(text: string): unknown {
    if (text === 'true') {
        return true;
    }
    if (text === 'false') {
        return false;
    }
    return text;
}

function fileSection(file: Record<string, unknown>, name: keyof QuarantineFix): Record<string, unknown> {
    const section: unknown = file[name];
    if (section === undefined) {
        return {};
    }
    if (typeof section !== 'object' || section === null || Array.isArray(section)) {
        throw usageError(`"${name}" no arquivo precisa ser um objeto.`);
    }
    return { ...(section as Record<string, unknown>) };
}

export function readFixFile(path: string): QuarantineFix {
    let parsed: unknown;
    try {
        parsed = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
        throw usageError(
            `Não consegui ler o JSON de ${path}.`,
            'O arquivo tem o formato do PATCH: { "values": {...}, "properties": {...} }.'
        );
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw usageError('O arquivo precisa ser um objeto JSON.', 'Formato: { "values": {...}, "properties": {...} }.');
    }
    const file: Record<string, unknown> = parsed as Record<string, unknown>;
    return { values: fileSection(file, 'values'), properties: fileSection(file, 'properties') };
}

/**
 * `campo=valor` vai para os campos nativos (`values`); `properties.chave=valor` para as propriedades.
 * `true` e `false` viram booleano; o resto é texto (para outro tipo, use `--file`).
 */
export function fixFrom(sets: readonly string[], file: QuarantineFix | null): QuarantineFix {
    const values: Record<string, unknown> = { ...file?.values };
    const properties: Record<string, unknown> = { ...file?.properties };
    for (const entry of sets) {
        const at: number = entry.indexOf('=');
        if (at <= 0) {
            throw usageError(`"${entry}" não está no formato campo=valor.`, 'Exemplo: --set cnpj=12345678000190');
        }
        const key: string = entry.slice(0, at);
        const value: unknown = scalar(entry.slice(at + 1));
        const target: Record<string, unknown> = isProperty(key) ? properties : values;
        target[isProperty(key) ? key.slice(PROPERTIES_PREFIX.length) : key] = value;
    }
    if (Object.keys(values).length === 0 && Object.keys(properties).length === 0) {
        throw usageError('Nada para corrigir.', 'Use --set campo=valor ou --file <json>.');
    }
    return { values, properties };
}

function show(value: unknown): string {
    return typeof value === 'string' ? value : JSON.stringify(value);
}

export function describeItem(item: QuarantineItem): readonly string[] {
    const fields: readonly string[] = [
        ...Object.entries(item.record.values).map(([key, value]: [string, unknown]) => `    ${key}: ${show(value)}`),
        ...Object.entries(item.record.properties).map(([key, value]: [string, unknown]) => `    ${PROPERTIES_PREFIX}${key}: ${show(value)}`)
    ];
    return [
        `${item.id}  ${item.objectType}  execução ${item.runId}`,
        `  motivo: ${item.reason}`,
        ...(fields.length === 0 ? [] : ['  valores:', ...fields])
    ];
}

export function fixPreview(item: QuarantineItem, fix: QuarantineFix): { readonly title: string; readonly changes: readonly string[] } {
    const lines = (kind: 'values' | 'properties', prefix: string): readonly string[] =>
        Object.entries(fix[kind]).map(
            ([key, value]: [string, unknown]) => `${prefix}${key}: ${show(item.record[kind][key] ?? '(vazio)')} → ${show(value)}`
        );
    return {
        title: `Corrigir o registro ${item.id} (${item.objectType}) da quarentena`,
        changes: [...lines('values', ''), ...lines('properties', PROPERTIES_PREFIX), 'O registro volta ao Nexo no próximo reprocessamento.']
    };
}

export function describeWrites(writes: ExternalWrites): readonly string[] {
    const lines: string[] = [`Escreve no outro sistema: ${writes.externalWrites ? 'sim' : 'não'}`];
    lines.push(`Hosts confirmados: ${(writes.confirmed?.hosts ?? []).join(', ') || 'nenhum'}`);
    if (writes.needsConfirmation) {
        lines.push('Uma escrita espera a confirmação de uma pessoa.');
    }
    const held: HeldWrite | null = writes.held;
    if (held !== null) {
        lines.push(`Escrita retida ${held.id} (${held.status}), execução ${held.runId}:`, `  ${held.method} ${held.url}`);
        if (held.body !== null) {
            lines.push(`  corpo: ${held.body}`);
        }
        if (held.failureNotice !== null) {
            lines.push(`  ${held.failureNotice}`);
        }
    }
    return lines;
}
