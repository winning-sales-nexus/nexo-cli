import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CliError, usageError } from '../errors.js';
import { EXIT_CODES } from '../exit-codes.types.js';

export const CODE_FILE: string = 'connector.ts';
export const MANIFEST_FILE: string = 'manifest.json';
export const STATE_FILE: string = 'nexo-connector.json';
export const SDK_FILE: string = 'connect-sdk.d.ts';

export interface ConnectorState {
    readonly connectorId: string | null;
    readonly name: string;
    readonly systemId: string | null;
    readonly baseSeq: number | null;
}

export interface ConnectorFiles {
    readonly code: string;
    readonly manifest: Record<string, unknown>;
}

export function projectDirectory(raw: string | undefined): string {
    return resolve(raw ?? '.');
}

function isState(value: unknown): value is ConnectorState {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const fields: Partial<Record<keyof ConnectorState, unknown>> = value;
    return typeof fields.name === 'string' && (fields.connectorId === null || typeof fields.connectorId === 'string');
}

function readJsonFile(path: string): unknown {
    try {
        return JSON.parse(readFileSync(path, 'utf8')) as unknown;
    } catch {
        throw usageError(`${path} não é JSON válido.`);
    }
}

export function readState(directory: string): ConnectorState {
    const path: string = join(directory, STATE_FILE);
    if (!existsSync(path)) {
        throw usageError(
            `Não há um conector em ${directory}.`,
            'Crie com `nexo connect init <pasta>` ou baixe com `nexo connect pull <id> <pasta>`.'
        );
    }
    const state: unknown = readJsonFile(path);
    if (!isState(state)) {
        throw usageError(`${path} não tem o formato da CLI.`);
    }
    return state;
}

export function writeState(directory: string, state: ConnectorState): void {
    writeFileSync(join(directory, STATE_FILE), `${JSON.stringify(state, null, 2)}\n`);
}

export function readFiles(directory: string): ConnectorFiles {
    const codePath: string = join(directory, CODE_FILE);
    if (!existsSync(codePath)) {
        throw usageError(`Falta ${CODE_FILE} em ${directory}.`);
    }
    const manifest: unknown = readJsonFile(join(directory, MANIFEST_FILE));
    if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
        throw usageError(`${MANIFEST_FILE} precisa ser um objeto JSON.`);
    }
    return { code: readFileSync(codePath, 'utf8'), manifest: { ...manifest } };
}

export function writeFiles(directory: string, files: ConnectorFiles): void {
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, CODE_FILE), files.code.endsWith('\n') ? files.code : `${files.code}\n`);
    writeFileSync(join(directory, MANIFEST_FILE), `${JSON.stringify(files.manifest, null, 2)}\n`);
}

export function ensureEmpty(directory: string): void {
    if (existsSync(directory) && readdirSync(directory).length > 0) {
        throw new CliError(`${directory} já tem arquivos.`, EXIT_CODES.usage, 'Escolha uma pasta nova ou vazia.');
    }
}
