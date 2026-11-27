import { randomBytes } from 'node:crypto';
import type { Session } from '../config/session.js';
import { clientOf, printJson, printLine, sessionOf } from '../context.js';
import type { CliContext } from '../context.js';
import { describeSecret, describeWebhook, isSecretList, isWebhook } from '../connect/access.js';
import type { SecretSlot, Webhook } from '../connect/access.js';
import { usageError } from '../errors.js';
import type { ApiResponse } from '../http/nexo-client.js';
import { connectorIdOf, secretValue } from './connect-runs.js';
import type { ConnectRunOptions } from './connect-runs.js';

export interface AccessOptions extends Omit<ConnectRunOptions, 'confirm'> {
    /** O sim local (sem token): as rotas de acesso não têm prévia no `/v1`. */
    readonly confirm?: boolean;
    readonly generate?: boolean;
}

interface Target {
    readonly session: Session;
    readonly base: string;
}

function targetOf(context: CliContext, dir: string | undefined, options: AccessOptions): Target {
    const connectorId: string = connectorIdOf(options, dir);
    return { session: sessionOf(context, options), base: `/v1/connect/connectors/${connectorId}` };
}

async function read<T>(context: CliContext, target: Target, path: string, guard: (value: unknown) => value is T, what: string): Promise<T> {
    const response: ApiResponse = await clientOf(context, target.session).request({ method: 'GET', path: `${target.base}/${path}` });
    if (!guard(response.body)) {
        throw new Error(`${what} em formato inesperado.`);
    }
    return response.body;
}

export async function secretsList(context: CliContext, dir: string | undefined, options: AccessOptions): Promise<void> {
    const slots: readonly SecretSlot[] = await read(context, targetOf(context, dir, options), 'secrets', isSecretList, 'Lista de segredos');
    if (options.json === true) {
        printJson(context, slots);
        return;
    }
    if (slots.length === 0) {
        printLine(context, 'A versão em edição não pede segredo nenhum.');
        return;
    }
    for (const slot of slots) {
        printLine(context, describeSecret(slot));
    }
}

export async function webhookShow(context: CliContext, dir: string | undefined, options: AccessOptions): Promise<void> {
    const webhook: Webhook = await read(context, targetOf(context, dir, options), 'webhook', isWebhook, 'Webhook');
    if (options.json === true) {
        printJson(context, webhook);
        return;
    }
    for (const line of describeWebhook(webhook)) {
        printLine(context, line);
    }
}

export async function webhookSecretSet(context: CliContext, dir: string | undefined, options: AccessOptions): Promise<void> {
    if (options.generate === true && (options.stdin === true || options.json === true)) {
        throw usageError('--generate não vai com --stdin nem --json: o valor gerado sai uma vez, na tela.');
    }
    const target: Target = targetOf(context, dir, options);
    const secret: string =
        options.generate === true ? randomBytes(32).toString('hex') : await secretValue(context, 'o segredo do webhook', options);
    if (secret === '') {
        throw usageError('O valor veio vazio; nada foi salvo.');
    }
    const response: ApiResponse = await clientOf(context, target.session).request({
        method: 'PUT',
        path: `${target.base}/webhook/secret`,
        body: { secret }
    });
    if (options.json === true) {
        printJson(context, response.body);
        return;
    }
    printLine(context, 'Segredo do webhook salvo. O anterior deixou de valer na hora.');
    if (options.generate === true) {
        printLine(context, `Segredo: ${secret}`);
        printLine(context, 'Este valor sai só agora e não volta. Leve-o ao outro sistema; ele não dá acesso ao Nexo.');
    }
}
