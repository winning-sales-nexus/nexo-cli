import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CliError } from './errors.js';
import { EXIT_CODES } from './exit-codes.types.js';

export const ASSETS_DIRECTORY: string = fileURLToPath(new URL('../assets/', import.meta.url));

export function assetPath(relative: string): string {
    return fileURLToPath(new URL(`../assets/${relative}`, import.meta.url));
}

export function readAsset(relative: string): string {
    try {
        return readFileSync(assetPath(relative), 'utf8');
    } catch {
        throw new CliError(`Arquivo da CLI ausente: assets/${relative}.`, EXIT_CODES.failure, 'Reinstale a CLI.');
    }
}
