import { CliError } from '../errors.js';
import { EXIT_CODES } from '../exit-codes.types.js';

/** Quanto esperar a pessoa agir no navegador: o intervalo, o limite e o relógio (o padrão é `Date.now`). */
export interface Patience {
    readonly intervalMs: number;
    readonly timeoutMs: number;
    readonly now?: () => number;
}

export const DEFAULT_PATIENCE: Patience = { intervalMs: 3000, timeoutMs: 10 * 60_000 };

/**
 * Confere `check` de tempos em tempos até ele devolver algo, ou o limite passar.
 * O relógio só mede a espera: o que vale é o estado lido, nunca a hora da máquina contra a do servidor.
 */
export async function pollUntil<T>(
    check: () => Promise<T | null>,
    pause: (ms: number) => Promise<void>,
    patience: Patience,
    onTimeout: () => CliError
): Promise<T> {
    const now: () => number = patience.now ?? Date.now;
    const deadline: number = now() + patience.timeoutMs;
    for (;;) {
        const found: T | null = await check();
        if (found !== null) {
            return found;
        }
        if (now() >= deadline) {
            throw onTimeout();
        }
        await pause(patience.intervalMs);
    }
}

export function timedOut(message: string, hint: string): () => CliError {
    return () => new CliError(message, EXIT_CODES.failure, hint);
}

function fieldsOf(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function strings(value: unknown): value is readonly string[] {
    return Array.isArray(value) && value.every((item: unknown) => typeof item === 'string');
}

export interface SecretSlot {
    readonly name: string;
    readonly label?: string;
    readonly filled: boolean;
    readonly setAt: string | null;
}

/** Como o manifesto declara que a chamada é do outro sistema: o tipo, os cabeçalhos e os NOMES dos segredos, nunca um valor. */
export interface WebhookAuth {
    readonly type: 'header' | 'basic' | 'hmac';
    readonly header?: string;
    readonly secret: string;
    readonly user?: string;
    readonly algorithm?: string;
    readonly encoding?: string;
    readonly prefix?: string;
    readonly signed?: string;
    readonly timestampHeader?: string;
    readonly toleranceSeconds?: number;
}

export interface Webhook {
    readonly url: string;
    /** A da versão publicada: a que confere as chamadas agora. */
    readonly auth: WebhookAuth | null;
    /** A da versão em edição: a que vale depois de publicar. */
    readonly authInEdit: WebhookAuth | null;
}

export interface WebhookDelivery {
    readonly receivedAt: string;
    readonly contentType: string | null;
    readonly sizeBytes: number;
    readonly outcome: string;
    readonly reason: string | null;
    readonly runId: string | null;
    readonly runStatus: string | null;
}

export interface WebhookDeliveryList {
    readonly deliveries: readonly WebhookDelivery[];
    readonly next: string | null;
}

export interface OAuthStatus {
    readonly required: boolean;
    readonly app: 'nexo' | 'own' | 'none';
    readonly systemName: string | null;
    readonly clientId: string | null;
    readonly status: 'unauthorized' | 'authorized' | 'revoked';
    readonly authorizedAt: string | null;
    readonly expiresAt: string | null;
    readonly revokedReason: string | null;
}

export interface OAuthAuthorization {
    readonly authorizeUrl: string;
    readonly expiresAt: string;
}

export interface SftpKey {
    readonly host: string;
    readonly port: number;
    readonly fingerprint: string;
    readonly pinnedAt: string;
}

export interface MailAddress {
    readonly address: string | null;
    readonly senders: readonly string[];
}

export interface MailFile {
    readonly name: string;
    readonly sizeBytes: number;
    readonly receivedAt: string;
    readonly status: 'received' | 'ignored';
    readonly ignoredReason: string | null;
}

export function isSecretList(value: unknown): value is readonly SecretSlot[] {
    return (
        Array.isArray(value) &&
        value.every((item: unknown) => {
            const fields: Record<string, unknown> | null = fieldsOf(item);
            return fields !== null && typeof fields.name === 'string' && typeof fields.filled === 'boolean';
        })
    );
}

export function isWebhook(value: unknown): value is Webhook {
    const fields: Record<string, unknown> | null = fieldsOf(value);
    return fields !== null && typeof fields.url === 'string' && isAuthOrNull(fields.auth) && isAuthOrNull(fields.authInEdit);
}

function isAuthOrNull(value: unknown): boolean {
    if (value === null) {
        return true;
    }
    const fields: Record<string, unknown> | null = fieldsOf(value);
    return fields !== null && typeof fields.type === 'string' && typeof fields.secret === 'string';
}

export function isWebhookDeliveryList(value: unknown): value is WebhookDeliveryList {
    const fields: Record<string, unknown> | null = fieldsOf(value);
    return (
        fields !== null &&
        Array.isArray(fields.deliveries) &&
        fields.deliveries.every((item: unknown) => isDelivery(item)) &&
        (fields.next === null || typeof fields.next === 'string')
    );
}

function isDelivery(item: unknown): boolean {
    const delivery: Record<string, unknown> | null = fieldsOf(item);
    return delivery !== null && typeof delivery.receivedAt === 'string' && typeof delivery.outcome === 'string';
}

export function isOAuthStatus(value: unknown): value is OAuthStatus {
    const fields: Record<string, unknown> | null = fieldsOf(value);
    return fields !== null && typeof fields.required === 'boolean' && typeof fields.status === 'string' && typeof fields.app === 'string';
}

export function isOAuthAuthorization(value: unknown): value is OAuthAuthorization {
    const fields: Record<string, unknown> | null = fieldsOf(value);
    return fields !== null && typeof fields.authorizeUrl === 'string';
}

function isSftpKey(value: unknown): value is SftpKey {
    const fields: Record<string, unknown> | null = fieldsOf(value);
    return fields !== null && typeof fields.host === 'string' && typeof fields.port === 'number' && typeof fields.fingerprint === 'string';
}

export function isSftpKeyList(value: unknown): value is readonly SftpKey[] {
    return Array.isArray(value) && value.every(isSftpKey);
}

export function isMailAddress(value: unknown): value is MailAddress {
    const fields: Record<string, unknown> | null = fieldsOf(value);
    return fields !== null && (fields.address === null || typeof fields.address === 'string') && strings(fields.senders);
}

export function isMailFileList(value: unknown): value is readonly MailFile[] {
    return (
        Array.isArray(value) &&
        value.every((item: unknown) => {
            const fields: Record<string, unknown> | null = fieldsOf(item);
            return fields !== null && typeof fields.name === 'string' && typeof fields.status === 'string';
        })
    );
}

export function describeSecret(slot: SecretSlot): string {
    return `${slot.name.padEnd(28)} ${slot.filled ? `preenchido${slot.setAt === null ? '' : ` desde ${slot.setAt}`}` : 'faltando'}`;
}

export const WEBHOOK_URL_WARNING: string =
    'O endereço é a credencial do webhook: quem o tem pode chamá-lo. Não o cole em lugar público nem em chat; só no outro sistema.';

const OUTCOME_NAMES: Readonly<Record<string, string>> = {
    ran: 'rodou',
    waiting: 'esperando a vez',
    refused: 'recusada',
    discarded: 'descartada'
};

const REASON_NAMES: Readonly<Record<string, string>> = {
    missing: 'a chamada veio sem a autenticação declarada',
    mismatch: 'a autenticação não confere com o segredo',
    stale: 'a hora da chamada está fora da tolerância',
    secret_missing: 'o segredo da autenticação não está preenchido no Nexo',
    not_published: 'o conector não tem versão publicada',
    no_webhook_trigger: 'a versão publicada não tem gatilho de webhook',
    disabled: 'o conector está desligado',
    paused: 'o conector está pausado',
    unstorable: 'o corpo não pôde ser guardado'
};

/** Os nomes dos segredos que a autenticação usa, sem repetir. */
export function authSecretNames(auth: WebhookAuth | null): readonly string[] {
    return auth === null
        ? []
        : [...new Set([auth.user, auth.secret].filter((name: string | undefined): name is string => name !== undefined))];
}

function describeHmac(auth: WebhookAuth): string {
    const timed: boolean = auth.signed === 'timestamp.body';
    const prefix: string = auth.prefix === undefined || auth.prefix === '' ? '' : ` (com o prefixo ${auth.prefix})`;
    const time: string = timed
        ? `; o cabeçalho ${auth.timestampHeader ?? '?'} leva a hora, em segundos (${String(auth.toleranceSeconds ?? 300)} s de tolerância)`
        : '';
    const algorithm: string = (auth.algorithm ?? 'sha256').toUpperCase();
    return `assinatura HMAC-${algorithm} (${auth.encoding ?? 'hex'}) de ${timed ? '"<hora>.<corpo>"' : 'o corpo'} com o segredo ${auth.secret}, no cabeçalho ${auth.header ?? '?'}${prefix}${time}`;
}

export function describeAuth(auth: WebhookAuth): string {
    if (auth.type === 'header') {
        return `o cabeçalho ${auth.header ?? '?'} leva o valor do segredo ${auth.secret}`;
    }
    if (auth.type === 'basic') {
        return `HTTP Basic, com o usuário do segredo ${auth.user ?? '?'} e a senha do segredo ${auth.secret}`;
    }
    return describeHmac(auth);
}

/** `missing`: os nomes de segredo da autenticação que o Nexo ainda não tem preenchidos. */
export function describeWebhook(webhook: Webhook, missing: readonly string[]): readonly string[] {
    const lines: string[] = [`URL: ${webhook.url} (POST)`, WEBHOOK_URL_WARNING];
    lines.push(
        webhook.auth === null
            ? 'Autenticação publicada: nenhuma (sem versão publicada, sem gatilho de webhook ou sem auth declarada); só o endereço prova a chamada.'
            : `Autenticação publicada (a que confere as chamadas agora): ${describeAuth(webhook.auth)}.`
    );
    if (JSON.stringify(webhook.authInEdit) !== JSON.stringify(webhook.auth)) {
        lines.push(
            webhook.authInEdit === null
                ? 'Na versão em edição: nenhuma autenticação (vale depois de publicar).'
                : `Na versão em edição (vale depois de publicar): ${describeAuth(webhook.authInEdit)}.`
        );
    }
    if (missing.length > 0) {
        lines.push(`Falta preencher: ${missing.join(', ')}. Preencha com \`nexo connect secrets set <NOME>\`.`);
    }
    return lines;
}

export function describeDelivery(delivery: WebhookDelivery): string {
    const reason: string | null = delivery.reason === null ? null : (REASON_NAMES[delivery.reason] ?? delivery.reason);
    const run: string =
        delivery.runId === null ? '' : ` execução ${delivery.runId}${delivery.runStatus === null ? '' : ` (${delivery.runStatus})`}`;
    return `${delivery.receivedAt}  ${(OUTCOME_NAMES[delivery.outcome] ?? delivery.outcome).padEnd(15)} ${delivery.contentType ?? 'sem tipo'}, ${String(delivery.sizeBytes)} bytes${
        reason === null ? '' : `; motivo: ${reason}`
    }${run === '' ? '' : `;${run}`}`;
}

const APP_NAMES: Readonly<Record<OAuthStatus['app'], string>> = {
    nexo: 'o app do Nexo',
    own: 'o app da própria empresa',
    none: 'nenhum (a empresa precisa trazer o app dela)'
};

const STATUS_NAMES: Readonly<Record<OAuthStatus['status'], string>> = {
    unauthorized: 'não autorizado',
    authorized: 'autorizado',
    revoked: 'revogado pelo outro sistema'
};

export function describeOAuth(oauth: OAuthStatus): readonly string[] {
    return [
        oauth.required ? 'A versão em edição pede OAuth.' : 'A versão em edição não pede OAuth.',
        `Sistema: ${oauth.systemName ?? 'fora do catálogo'}. App: ${APP_NAMES[oauth.app]}${oauth.clientId === null ? '' : ` (client id ${oauth.clientId})`}.`,
        `Estado: ${STATUS_NAMES[oauth.status]}${oauth.authorizedAt === null ? '' : `, autorizado em ${oauth.authorizedAt}`}${oauth.expiresAt === null ? '' : `, o token vale até ${oauth.expiresAt} e o Nexo o renova`}.`,
        ...(oauth.revokedReason === null
            ? []
            : [`Motivo da revogação: ${oauth.revokedReason}. Autorize de novo com \`nexo connect oauth authorize\`.`])
    ];
}

export function describeSftpKey(key: SftpKey): string {
    return `${key.host}:${String(key.port)}  ${key.fingerprint}  guardada em ${key.pinnedAt}`;
}

export function describeMail(mail: MailAddress): readonly string[] {
    return [
        mail.address === null ? 'Endereço: ainda não gerado. Gere com `nexo connect email renew`.' : `Endereço: ${mail.address}`,
        mail.senders.length === 0 ? 'Quem pode mandar: ninguém declarado no manifesto.' : `Quem pode mandar: ${mail.senders.join(', ')}`
    ];
}

const IGNORED_REASONS: Readonly<Record<string, string>> = {
    not_spreadsheet: 'não é planilha (.csv, .tsv, .txt ou .xlsx)',
    too_large: 'passou do limite de tamanho',
    empty: 'sem conteúdo'
};

export function describeMailFile(file: MailFile): string {
    const left: string =
        file.status === 'received'
            ? 'recebido'
            : `deixado de fora: ${IGNORED_REASONS[file.ignoredReason ?? ''] ?? file.ignoredReason ?? '?'}`;
    return `${file.receivedAt}  ${file.name}  ${String(file.sizeBytes)} bytes  ${left}`;
}
