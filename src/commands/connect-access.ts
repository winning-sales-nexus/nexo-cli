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
    authSecretNames,
    describeDelivery,
    describeWebhook,
    isMailAddress,
    isMailFileList,
    isOAuthAuthorization,
    isOAuthStatus,
    isSecretList,
    isSftpKeyList,
    isWebhook,
    isWebhookDeliveryList,
    pollUntil,
    timedOut,
    WEBHOOK_URL_WARNING
} from '../connect/access.js';
import type {
    MailAddress,
    MailFile,
    OAuthAuthorization,
    OAuthStatus,
    Patience,
    SecretSlot,
    SftpKey,
    Webhook,
    WebhookDeliveryList
} from '../connect/access.js';
import { requestChange, requestLocalChange } from '../connect/changes.js';
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

/** Os segredos que a autenticação do webhook usa e o Nexo ainda não tem preenchidos; sem a lista, não afirma nada. */
async function missingSecrets(context: CliContext, target: Target, webhook: Webhook): Promise<readonly string[]> {
    const names: readonly string[] = [...new Set([...authSecretNames(webhook.auth), ...authSecretNames(webhook.authInEdit)])];
    if (names.length === 0) {
        return [];
    }
    const slots: readonly SecretSlot[] = await read(context, target, 'secrets', isSecretList, 'Lista de segredos');
    const filled: ReadonlySet<string> = new Set(slots.filter((slot: SecretSlot) => slot.filled).map((slot: SecretSlot) => slot.name));
    return names.filter((name: string) => !filled.has(name));
}

export async function webhookShow(context: CliContext, dir: string | undefined, options: AccessOptions): Promise<void> {
    const target: Target = targetOf(context, dir, options);
    const webhook: Webhook = await read(context, target, 'webhook', isWebhook, 'Webhook');
    const missing: readonly string[] = await missingSecrets(context, target, webhook);
    if (options.json === true) {
        printJson(context, { ...webhook, missingSecrets: missing, urlIsCredential: true });
        return;
    }
    for (const line of describeWebhook(webhook, missing)) {
        printLine(context, line);
    }
}

export interface WebhookDeliveriesOptions extends AccessOptions {
    readonly before?: string;
    readonly limit?: string;
}

function deliveriesPath(options: WebhookDeliveriesOptions): string {
    const query: URLSearchParams = new URLSearchParams();
    if (options.before !== undefined) {
        query.set('before', options.before);
    }
    if (options.limit !== undefined) {
        const limit: number = Number(options.limit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
            throw usageError('--limit pede um número inteiro de 1 a 100.');
        }
        query.set('limit', String(limit));
    }
    return `webhook/deliveries${query.size === 0 ? '' : `?${query.toString()}`}`;
}

export async function webhookDeliveries(context: CliContext, dir: string | undefined, options: WebhookDeliveriesOptions): Promise<void> {
    const target: Target = targetOf(context, dir, options);
    const path: string = deliveriesPath(options);
    const list: WebhookDeliveryList = await read(context, target, path, isWebhookDeliveryList, 'Lista de entregas');
    if (options.json === true) {
        printJson(context, list);
        return;
    }
    if (list.deliveries.length === 0) {
        printLine(context, 'Nenhuma entrega no webhook ainda.');
        return;
    }
    for (const delivery of list.deliveries) {
        printLine(context, describeDelivery(delivery));
    }
    if (list.next !== null) {
        printLine(context, `Há mais: use --before ${list.next}.`);
    }
}

/** Troca o token do endereço: prévia do `/v1`, o sim (ou `--yes`) e só então aplica. O endereço antigo para na hora. */
export async function webhookRotate(context: CliContext, dir: string | undefined, options: ConnectRunOptions): Promise<void> {
    if (options.confirm !== undefined && options.confirm.trim() === '') {
        throw usageError('--confirm pede o token da prévia; o valor veio vazio. Nada foi trocado.');
    }
    await requestChange(context, sessionOf(context, options), {
        connectorId: connectorIdOf(options, dir),
        path: 'webhook/token',
        command: 'nexo connect webhook rotate',
        summarize: (body: unknown): readonly string[] =>
            isWebhook(body)
                ? [
                      `Novo endereço: ${body.url}`,
                      WEBHOOK_URL_WARNING,
                      'O endereço anterior parou de valer agora: leve este ao outro sistema.'
                  ]
                : [],
        confirm: options.confirm,
        yes: options.yes === true,
        json: options.json === true
    });
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
