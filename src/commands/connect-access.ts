import { randomBytes } from 'node:crypto';
import type { Session } from '../config/session.js';
import { clientOf, printJson, printLine, printNotice, sessionOf } from '../context.js';
import type { CliContext } from '../context.js';
import {
    DEFAULT_PATIENCE,
    describeMail,
    describeMailFile,
    describeOAuth,
    describeSecret,
    describeSftpKey,
    describeWebhook,
    isMailAddress,
    isMailFileList,
    isOAuthAuthorization,
    isOAuthStatus,
    isSecretList,
    isSftpKeyList,
    isWebhook,
    pollUntil,
    timedOut
} from '../connect/access.js';
import type { MailAddress, MailFile, OAuthAuthorization, OAuthStatus, Patience, SecretSlot, SftpKey, Webhook } from '../connect/access.js';
import { requestLocalChange } from '../connect/changes.js';
import { usageError } from '../errors.js';
import { pause } from '../documents/journey-api.js';
import { NexoApiError } from '../http/problem.js';
import type { ApiResponse } from '../http/nexo-client.js';
import { fetchConnector } from './connect-files.js';
import type { ConnectorView } from './connect-files.js';
import { openOrShow, screenLink } from './connect-hosts.js';
import { connectorIdOf, secretValue } from './connect-runs.js';
import type { ConnectRunOptions } from './connect-runs.js';

export interface AccessOptions extends Omit<ConnectRunOptions, 'confirm'> {
    /** O sim local (sem token): as rotas de acesso não têm prévia no `/v1`. */
    readonly confirm?: boolean;
    readonly generate?: boolean;
    readonly clientId?: string;
    readonly port?: string;
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

export async function oauthShow(context: CliContext, dir: string | undefined, options: AccessOptions): Promise<void> {
    const oauth: OAuthStatus = await read(context, targetOf(context, dir, options), 'oauth', isOAuthStatus, 'Estado do OAuth');
    if (options.json === true) {
        printJson(context, oauth);
        return;
    }
    for (const line of describeOAuth(oauth)) {
        printLine(context, line);
    }
}

const CLIENT_WARNING: string =
    'Trocar ou tirar o app da empresa derruba as autorizações do app anterior: o conector para de acessar o outro sistema até autorizar de novo.';

async function putClient(context: CliContext, target: Target, clientId: string, options: AccessOptions): Promise<ApiResponse> {
    const clientSecret: string = await secretValue(context, 'o client secret', options);
    if (clientSecret === '') {
        throw usageError('O valor veio vazio; nada foi salvo.');
    }
    return clientOf(context, target.session).request({
        method: 'PUT',
        path: `${target.base}/oauth/client`,
        body: { clientId, clientSecret }
    });
}

export async function oauthClientSet(context: CliContext, dir: string | undefined, options: AccessOptions): Promise<void> {
    if (options.clientId === undefined || options.clientId.trim() === '') {
        throw usageError(
            'Diga o client id do app da empresa.',
            'Use --client-id <id>; o client secret é digitado sem eco, ou vem por --stdin.'
        );
    }
    const clientId: string = options.clientId.trim();
    const target: Target = targetOf(context, dir, options);
    await requestLocalChange(context, {
        preview: {
            title: `Usar o app OAuth da empresa (client id ${clientId})`,
            changes: [CLIENT_WARNING, 'O client secret é guardado cifrado e nunca volta pela API nem aparece aqui.']
        },
        command: `nexo connect oauth client set --client-id ${clientId} --stdin`,
        confirmed: options.confirm === true,
        yes: options.yes === true,
        json: options.json === true,
        apply: () => putClient(context, target, clientId, options),
        report: () => {
            printLine(context, `App da empresa (client id ${clientId}) salvo. Autorize de novo com \`nexo connect oauth authorize\`.`);
        }
    });
}

export async function oauthClientRemove(context: CliContext, dir: string | undefined, options: AccessOptions): Promise<void> {
    const target: Target = targetOf(context, dir, options);
    await requestLocalChange(context, {
        preview: {
            title: 'Voltar ao app OAuth do Nexo',
            changes: [CLIENT_WARNING, 'Depois, autorize com o app do Nexo.']
        },
        command: 'nexo connect oauth client remove',
        confirmed: options.confirm === true,
        yes: options.yes === true,
        json: options.json === true,
        apply: () => clientOf(context, target.session).request({ method: 'DELETE', path: `${target.base}/oauth/client` }),
        report: () => {
            printLine(context, 'App da empresa removido. Autorize de novo com `nexo connect oauth authorize`.');
        }
    });
}

async function startAuthorization(context: CliContext, target: Target, connectorId: string): Promise<OAuthAuthorization> {
    try {
        const response: ApiResponse = await clientOf(context, target.session).request({
            method: 'POST',
            path: `${target.base}/oauth/authorize`
        });
        if (!isOAuthAuthorization(response.body)) {
            throw new Error('Autorização em formato inesperado.');
        }
        return response.body;
    } catch (error: unknown) {
        if (error instanceof NexoApiError && error.problem.status === 409) {
            const view: ConnectorView = await fetchConnector(context, target.session, connectorId);
            await openOrShow(
                context,
                target.session,
                screenLink(view, 'oauth'),
                'a tela do conector, no OAuth, onde a empresa traz o app dela'
            );
        }
        throw error;
    }
}

export async function oauthAuthorize(
    context: CliContext,
    dir: string | undefined,
    options: AccessOptions,
    patience: Patience = DEFAULT_PATIENCE
): Promise<void> {
    const connectorId: string = connectorIdOf(options, dir);
    const target: Target = { session: sessionOf(context, options), base: `/v1/connect/connectors/${connectorId}` };
    const before: OAuthStatus = await read(context, target, 'oauth', isOAuthStatus, 'Estado do OAuth');
    const authorization: OAuthAuthorization = await startAuthorization(context, target, connectorId);
    printNotice(context, 'Autorize o Nexo na página do outro sistema, com a conta de quem é dono da chave.');
    printNotice(context, 'A volta passa pela página do Nexo, no navegador em que você está logado: não feche antes dela terminar.');
    await openOrShow(context, target.session, authorization.authorizeUrl, 'a página de autorização do outro sistema');
    if (options.wait === false) {
        return;
    }
    printNotice(context, 'Esperando a autorização (até 10 minutos)…');
    const after: OAuthStatus = await pollUntil(
        async () => {
            const now: OAuthStatus = await read(context, target, 'oauth', isOAuthStatus, 'Estado do OAuth');
            return now.status === 'authorized' && (before.status !== 'authorized' || now.authorizedAt !== before.authorizedAt) ? now : null;
        },
        (ms: number) => pause(context, ms),
        patience,
        timedOut(
            'A autorização não terminou a tempo.',
            'Rode `nexo connect oauth authorize` de novo (o pedido anterior deixa de valer) e confira com `nexo connect oauth`.'
        )
    );
    if (options.json === true) {
        printJson(context, after);
        return;
    }
    printLine(context, `Autorizado${after.expiresAt === null ? '' : `: o token vale até ${after.expiresAt} e o Nexo o renova`}.`);
}

export async function sftpKeys(context: CliContext, dir: string | undefined, options: AccessOptions): Promise<void> {
    const keys: readonly SftpKey[] = await read(context, targetOf(context, dir, options), 'sftp-host-keys', isSftpKeyList, 'Chaves SFTP');
    if (options.json === true) {
        printJson(context, keys);
        return;
    }
    if (keys.length === 0) {
        printLine(context, 'Nenhuma chave guardada: ela é guardada na primeira conexão SFTP que dá certo.');
        return;
    }
    for (const key of keys) {
        printLine(context, describeSftpKey(key));
    }
}

async function keptKey(context: CliContext, target: Target, host: string, port: number): Promise<SftpKey> {
    const keys: readonly SftpKey[] = await read(context, target, 'sftp-host-keys', isSftpKeyList, 'Chaves SFTP');
    const kept: SftpKey | undefined = keys.find((key: SftpKey) => key.host === host && key.port === port);
    if (kept === undefined) {
        throw usageError(`Não há chave guardada para ${host}:${String(port)}.`, 'Veja as guardadas com `nexo connect sftp keys`.');
    }
    return kept;
}

function portOf(raw: string | undefined): number {
    const port: number = raw === undefined ? 22 : Number(raw);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw usageError(`Porta inválida: ${String(raw)}.`);
    }
    return port;
}

export async function sftpAccept(context: CliContext, host: string, dir: string | undefined, options: AccessOptions): Promise<void> {
    const target: Target = targetOf(context, dir, options);
    const port: number = portOf(options.port);
    const name: string = host.trim().toLowerCase();
    const kept: SftpKey = await keptKey(context, target, name, port);
    await requestLocalChange(context, {
        preview: {
            title: `Aceitar a chave nova do servidor SFTP ${name}:${String(port)}`,
            changes: [
                `A chave guardada é ${kept.fingerprint} (desde ${kept.pinnedAt}).`,
                'Só aceite depois de confirmar com quem cuida do servidor que a chave mudou de propósito: uma chave trocada sem aviso pode ser um servidor falso.',
                'A chave antiga é apagada; a próxima conexão guarda a que o servidor mostrar então.'
            ]
        },
        command: `nexo connect sftp accept ${name} --port ${String(port)}`,
        confirmed: options.confirm === true,
        yes: options.yes === true,
        json: options.json === true,
        apply: () =>
            clientOf(context, target.session).request({
                method: 'POST',
                path: `${target.base}/sftp-host-keys/accept`,
                body: { host: name, port }
            }),
        report: () => {
            printLine(context, `Chave de ${name}:${String(port)} apagada. A próxima conexão guarda a nova.`);
        }
    });
}

export async function emailShow(context: CliContext, dir: string | undefined, options: AccessOptions): Promise<void> {
    const mail: MailAddress = await read(context, targetOf(context, dir, options), 'email', isMailAddress, 'Endereço de e-mail');
    if (options.json === true) {
        printJson(context, mail);
        return;
    }
    for (const line of describeMail(mail)) {
        printLine(context, line);
    }
}

export async function emailRenew(context: CliContext, dir: string | undefined, options: AccessOptions): Promise<void> {
    const target: Target = targetOf(context, dir, options);
    const current: MailAddress = await read(context, target, 'email', isMailAddress, 'Endereço de e-mail');
    await requestLocalChange(context, {
        preview: {
            title: current.address === null ? 'Gerar o endereço de e-mail do conector' : 'Gerar um endereço de e-mail novo para o conector',
            changes:
                current.address === null
                    ? ['O endereço recebe as planilhas que o outro sistema manda.']
                    : [
                          `O endereço atual (${current.address}) para de valer e o e-mail mandado a ele é descartado.`,
                          'Avise o outro sistema do endereço novo.'
                      ]
        },
        command: 'nexo connect email renew',
        confirmed: options.confirm === true,
        yes: options.yes === true,
        json: options.json === true,
        apply: () => clientOf(context, target.session).request({ method: 'POST', path: `${target.base}/email` }),
        report: (body: unknown) => {
            printLine(context, 'Endereço gerado.');
            if (isMailAddress(body)) {
                for (const line of describeMail(body)) {
                    printLine(context, line);
                }
            }
        }
    });
}

export async function emailFiles(context: CliContext, dir: string | undefined, options: AccessOptions): Promise<void> {
    const files: readonly MailFile[] = await read(
        context,
        targetOf(context, dir, options),
        'email/files',
        isMailFileList,
        'Arquivos do e-mail'
    );
    if (options.json === true) {
        printJson(context, files);
        return;
    }
    if (files.length === 0) {
        printLine(context, 'Nenhum arquivo chegou nos últimos 30 dias.');
        return;
    }
    for (const file of files) {
        printLine(context, describeMailFile(file));
    }
}
