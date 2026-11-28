import { createInterface } from 'node:readline';
import type { Interface } from 'node:readline';
import { clientOf, printJson, printLine, printNotice } from '../context.js';
import type { CliContext } from '../context.js';
import type { Session } from '../config/session.js';
import type { ApiResponse } from '../http/nexo-client.js';

export interface ChangeRequest {
    readonly connectorId: string;
    /** Caminho da mudança sob o conector, sem `/preview`: `publish`, `quarantine/reprocess`, `write-hosts/confirm`. */
    readonly path: string;
    /** Corpo da prévia e da aplicação (a aplicação soma o `confirmationToken`). */
    readonly body?: Readonly<Record<string, unknown>>;
    /** O comando que aplica, sem o `--confirm`: sai na dica de quem não tem terminal. */
    readonly command: string;
    /** Como contar o resultado depois de aplicar; sem isto, `Feito.`. */
    readonly summarize?: (body: unknown) => readonly string[];
    readonly confirm: string | undefined;
    readonly yes: boolean;
    readonly json: boolean;
    /** Aplicação por outro verbo e caminho (apagar é `DELETE` no conector, sem `/<path>`). */
    readonly applyAs?: { readonly method: 'DELETE'; readonly path: string };
    /** Texto que a pessoa digita para valer o sim; com ele, `-y` não basta e fora de um terminal só o `--confirm <token>`. */
    readonly typeToConfirm?: string;
}

interface Preview {
    readonly title: string;
    readonly changes: readonly string[];
    readonly confirmation: { readonly token: string; readonly expiresAt: string };
}

function isPreview(value: unknown): value is Preview {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const fields: Partial<Record<keyof Preview, unknown>> = value;
    return typeof fields.title === 'string' && Array.isArray(fields.changes) && typeof fields.confirmation === 'object';
}

export async function ask(context: CliContext, question: string): Promise<boolean> {
    const reader: Interface = createInterface({ input: context.stdin, output: context.stderr, terminal: true });
    try {
        const answer: string = await new Promise<string>((resolve: (text: string) => void) => {
            reader.question(question, resolve);
        });
        return /^(s|sim|y|yes)$/i.test(answer.trim());
    } finally {
        reader.close();
    }
}

async function apply(context: CliContext, session: Session, request: ChangeRequest, token: string): Promise<void> {
    const response: ApiResponse = await clientOf(context, session).request({
        method: request.applyAs?.method ?? 'POST',
        path: `/v1/connect/connectors/${request.connectorId}${request.applyAs === undefined ? `/${request.path}` : request.applyAs.path}`,
        body: { ...request.body, confirmationToken: token }
    });
    if (request.json) {
        printJson(context, response.body);
        return;
    }
    printLine(context, 'Feito.');
    for (const line of request.summarize?.(response.body) ?? []) {
        printLine(context, line);
    }
}

/** Com `--json` o stdout é um JSON só em todo caminho: a prévia vai para o stderr. */
function showPreviewFor(context: CliContext, preview: Pick<Preview, 'title' | 'changes'>, json: boolean): void {
    if (!json) {
        showPreview(context, preview);
        return;
    }
    printNotice(context, preview.title);
    for (const change of preview.changes) {
        printNotice(context, `  - ${change}`);
    }
}

export function showPreview(context: CliContext, preview: Pick<Preview, 'title' | 'changes'>): void {
    printLine(context, preview.title);
    for (const change of preview.changes) {
        printLine(context, `  - ${change}`);
    }
}

async function typedName(context: CliContext, expected: string): Promise<boolean> {
    const reader: Interface = createInterface({ input: context.stdin, output: context.stderr, terminal: true });
    try {
        const answer: string = await new Promise<string>((resolve: (text: string) => void) => {
            reader.question(`Para apagar, digite o nome do conector (${expected}): `, resolve);
        });
        return answer.trim() === expected;
    } finally {
        reader.close();
    }
}

async function decide(context: CliContext, session: Session, request: ChangeRequest, preview: Preview): Promise<void> {
    if (request.typeToConfirm !== undefined) {
        if (context.stdin.isTTY === true && (await typedName(context, request.typeToConfirm))) {
            await apply(context, session, request, preview.confirmation.token);
            return;
        }
        if (context.stdin.isTTY === true) {
            printNotice(context, 'O nome não confere. Nada mudou.');
            return;
        }
        printNotice(context, 'Mostre isto à pessoa. Depois do sim dela, aplique uma vez (-y sozinho não basta):');
        printNotice(context, `  ${request.command} --confirm ${preview.confirmation.token}`);
        return;
    }
    if (request.yes || (context.stdin.isTTY === true && (await ask(context, 'Confirma? (s/N) ')))) {
        await apply(context, session, request, preview.confirmation.token);
        return;
    }
    if (context.stdin.isTTY === true) {
        printNotice(context, 'Nada mudou.');
        return;
    }
    printNotice(context, 'Mostre isto à pessoa. Depois do sim dela, aplique uma vez:');
    printNotice(context, `  ${request.command} --confirm ${preview.confirmation.token}`);
}

export async function requestChange(context: CliContext, session: Session, request: ChangeRequest): Promise<void> {
    if (request.confirm !== undefined) {
        await apply(context, session, request, request.confirm);
        return;
    }
    const response: ApiResponse = await clientOf(context, session).request({
        method: 'POST',
        path: `/v1/connect/connectors/${request.connectorId}/${request.path}/preview`,
        ...(request.body === undefined ? {} : { body: request.body })
    });
    if (!isPreview(response.body)) {
        throw new Error('Prévia em formato inesperado.');
    }
    if (request.json && !request.yes) {
        printJson(context, response.body);
        return;
    }
    showPreviewFor(context, response.body, request.json);
    await decide(context, session, request, response.body);
}

export interface LocalChange {
    readonly preview: Pick<Preview, 'title' | 'changes'>;
    /** O comando que aplica, sem o `--confirm`: sai na dica de quem não tem terminal. */
    readonly command: string;
    readonly confirmed: boolean;
    readonly yes: boolean;
    readonly json: boolean;
    readonly apply: () => Promise<ApiResponse>;
    /** Como contar o resultado depois de aplicar; sem isto, `Feito.`. */
    readonly report?: (body: unknown) => void;
}

function reportApplied(context: CliContext, change: LocalChange, response: ApiResponse): void {
    if (change.json) {
        printJson(context, response.body);
        return;
    }
    if (change.report === undefined) {
        printLine(context, 'Feito.');
        return;
    }
    change.report(response.body);
}

/** Mudança sem prévia no `/v1`: a prévia é montada aqui e o sim é local (`--confirm` sem token). */
export async function requestLocalChange(context: CliContext, change: LocalChange): Promise<void> {
    const approved: boolean = change.yes || change.confirmed;
    if (change.json && !approved) {
        printJson(context, change.preview);
        return;
    }
    if (!change.json) {
        showPreview(context, change.preview);
    }
    if (approved || (context.stdin.isTTY === true && (await ask(context, 'Confirma? (s/N) ')))) {
        reportApplied(context, change, await change.apply());
        return;
    }
    if (context.stdin.isTTY === true) {
        printNotice(context, 'Nada mudou.');
        return;
    }
    printNotice(context, 'Mostre isto à pessoa. Depois do sim dela, aplique uma vez:');
    printNotice(context, `  ${change.command} --confirm`);
}
