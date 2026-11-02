import { createInterface } from 'node:readline';
import type { Interface } from 'node:readline';
import { clientOf, printJson, printLine, printNotice } from '../context.js';
import type { CliContext } from '../context.js';
import type { Session } from '../config/session.js';
import type { ApiResponse } from '../http/nexo-client.js';
import type { ChangeKind } from './changes.types.js';

export interface ChangeRequest {
    readonly connectorId: string;
    readonly kind: ChangeKind;
    readonly confirm: string | undefined;
    readonly yes: boolean;
    readonly json: boolean;
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

async function ask(context: CliContext, question: string): Promise<boolean> {
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
        method: 'POST',
        path: `/v1/connect/connectors/${request.connectorId}/${request.kind}`,
        body: { confirmationToken: token }
    });
    if (request.json) {
        printJson(context, response.body);
        return;
    }
    printLine(context, 'Feito.');
}

function showPreview(context: CliContext, preview: Preview): void {
    printLine(context, preview.title);
    for (const change of preview.changes) {
        printLine(context, `  - ${change}`);
    }
}

async function decide(context: CliContext, session: Session, request: ChangeRequest, preview: Preview): Promise<void> {
    if (request.yes || (context.stdin.isTTY === true && (await ask(context, 'Confirma? (s/N) ')))) {
        await apply(context, session, request, preview.confirmation.token);
        return;
    }
    if (context.stdin.isTTY === true) {
        printNotice(context, 'Nada mudou.');
        return;
    }
    printNotice(context, 'Mostre isto à pessoa. Depois do sim dela, aplique uma vez:');
    printNotice(context, `  nexo connect ${request.kind} --confirm ${preview.confirmation.token}`);
}

export async function requestChange(context: CliContext, session: Session, request: ChangeRequest): Promise<void> {
    if (request.confirm !== undefined) {
        await apply(context, session, request, request.confirm);
        return;
    }
    const response: ApiResponse = await clientOf(context, session).request({
        method: 'POST',
        path: `/v1/connect/connectors/${request.connectorId}/${request.kind}/preview`
    });
    if (!isPreview(response.body)) {
        throw new Error('Prévia em formato inesperado.');
    }
    if (request.json && !request.yes) {
        printJson(context, response.body);
        return;
    }
    showPreview(context, response.body);
    await decide(context, session, request, response.body);
}
