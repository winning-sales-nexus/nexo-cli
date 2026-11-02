import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CliError } from '../errors.js';
import { EXIT_CODES } from '../exit-codes.types.js';

export interface CallbackExpectation {
    readonly state: string;
    readonly issuer: string;
    readonly timeoutMs: number;
}

export interface LoopbackServer {
    readonly redirectUri: string;
    readonly code: (expectation: CallbackExpectation) => Promise<string>;
    readonly close: () => void;
}

const PAGE_STYLE: string = 'font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5';

function page(title: string, text: string): string {
    return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${title}</title><body style="${PAGE_STYLE}"><h1>${title}</h1><p>${text}</p></body></html>`;
}

function answer(response: ServerResponse, status: number, html: string): void {
    response.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(html);
}

function failure(message: string): CliError {
    return new CliError(message, EXIT_CODES.unauthenticated, 'Rode `nexo login` de novo.');
}

function outcomeOf(url: URL, expectation: CallbackExpectation): string | CliError {
    const error: string | null = url.searchParams.get('error');
    if (error !== null) {
        return failure(error === 'access_denied' ? 'A autorização foi negada no Nexo.' : `O Nexo recusou a autorização (${error}).`);
    }
    if (url.searchParams.get('state') !== expectation.state) {
        return failure('A resposta do navegador não é deste login (state diferente).');
    }
    const issuer: string | null = url.searchParams.get('iss');
    if (issuer !== null && issuer !== expectation.issuer) {
        return failure('A resposta veio de outro servidor de autorização.');
    }
    return url.searchParams.get('code') ?? failure('A resposta do navegador veio sem código.');
}

function waitForCode(server: Server, redirectUri: string, expectation: CallbackExpectation): Promise<string> {
    return new Promise<string>((resolve: (code: string) => void, reject: (error: CliError) => void) => {
        const timer: NodeJS.Timeout = setTimeout(() => {
            reject(failure('O login pelo navegador não terminou a tempo.'));
        }, expectation.timeoutMs);
        server.on('request', (request: IncomingMessage, response: ServerResponse) => {
            const url: URL = new URL(request.url ?? '/', redirectUri);
            if (url.pathname !== '/callback') {
                answer(response, 404, page('Nada aqui', 'Este endereço só recebe a volta do login do Nexo.'));
                return;
            }
            const outcome: string | CliError = outcomeOf(url, expectation);
            clearTimeout(timer);
            if (outcome instanceof CliError) {
                answer(response, 400, page('Não deu certo', `${outcome.message} Volte ao terminal.`));
                reject(outcome);
                return;
            }
            answer(response, 200, page('Pronto', 'A CLI do Nexo recebeu o acesso. Pode fechar esta aba e voltar ao terminal.'));
            resolve(outcome);
        });
    });
}

export async function startLoopbackServer(): Promise<LoopbackServer> {
    const server: Server = createServer();
    await new Promise<void>((resolve: () => void, reject: (error: Error) => void) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const port: number = (server.address() as AddressInfo).port;
    const redirectUri: string = `http://127.0.0.1:${String(port)}/callback`;
    return {
        redirectUri,
        code: (expectation: CallbackExpectation) => waitForCode(server, redirectUri, expectation),
        close: () => {
            server.closeAllConnections();
            server.close();
        }
    };
}
