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

export interface Webhook {
    readonly url: string;
    readonly secretSet: boolean;
    readonly signatureHeader: string;
    readonly timestampHeader: string;
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
    return fields !== null && typeof fields.url === 'string' && typeof fields.secretSet === 'boolean';
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

export function describeWebhook(webhook: Webhook): readonly string[] {
    return [
        `URL: ${webhook.url} (POST com corpo JSON)`,
        `Assinatura: o cabeçalho ${webhook.signatureHeader} leva sha256= e o HMAC-SHA256 de "<timestamp>.<corpo>" com o segredo; o cabeçalho ${webhook.timestampHeader} leva a hora da chamada, em segundos (5 minutos de tolerância).`,
        webhook.secretSet ? 'Segredo: definido.' : 'Segredo: ainda não definido. Defina com `nexo connect webhook secret set --generate`.'
    ];
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
