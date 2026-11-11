import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import type { CliContext } from '../context.js';
import { CliError, usageError } from '../errors.js';
import { EXIT_CODES } from '../exit-codes.types.js';
import type { UploadTicket } from './journey.types.js';

export interface LocalFile {
    readonly fileName: string;
    readonly bytes: Buffer;
}

export function localFile(path: string): LocalFile {
    try {
        if (!statSync(path).isFile()) {
            throw new Error('not a file');
        }
        return { fileName: basename(path), bytes: readFileSync(path) };
    } catch {
        throw usageError(`Não consegui ler o arquivo ${path}.`);
    }
}

export function readText(path: string): string {
    return localFile(path).bytes.toString('utf8');
}

export function targetOf(output: string | undefined, fileName: string | undefined, fallback: string): string {
    const name: string = basename(fileName ?? '');
    return resolve(output ?? (name === '' ? fallback : name));
}

async function transfer(context: CliContext, url: string, init: RequestInit, what: string): Promise<Response> {
    let response: Response;
    try {
        response = await context.fetchFn(url, init);
    } catch (error: unknown) {
        throw new CliError(`${what}: ${error instanceof Error ? error.message : String(error)}.`, EXIT_CODES.failure);
    }
    if (!response.ok) {
        throw new CliError(
            `${what}: o link respondeu ${String(response.status)}.`,
            EXIT_CODES.failure,
            'O link vale 15 minutos; peça de novo.'
        );
    }
    return response;
}

export async function download(context: CliContext, url: string, target: string): Promise<void> {
    const response: Response = await transfer(context, url, { method: 'GET' }, 'Não consegui baixar o arquivo');
    writeFileSync(target, Buffer.from(await response.arrayBuffer()));
}

export async function upload(context: CliContext, ticket: UploadTicket, file: LocalFile): Promise<void> {
    await transfer(
        context,
        ticket.upload.url,
        { method: 'PUT', headers: { 'content-type': ticket.upload.contentType }, body: new Uint8Array(file.bytes) },
        'Não consegui enviar o arquivo'
    );
}
