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
