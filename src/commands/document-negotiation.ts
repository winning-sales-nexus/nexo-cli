import { printJson, printLine, sessionOf } from '../context.js';
import type { CliContext } from '../context.js';
import type { Session } from '../config/session.js';
import { usageError } from '../errors.js';
import { call, documentOf, versionOf } from '../documents/journey-api.js';
import type { DocumentView, NegotiationPerson, VersionSummary } from '../documents/journey.types.js';
import { confirmed } from '../input/confirm.js';
import type { DocumentOptions } from './documents.js';

const NAMED: RegExp = /^\s*(.*?)\s*<\s*([^<>\s]+)\s*>\s*$/;
const EMAIL: RegExp = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function personOf(raw: string, approver: boolean): NegotiationPerson {
    const named: RegExpExecArray | null = NAMED.exec(raw);
    const email: string = (named?.[2] ?? raw).trim().toLowerCase();
    const name: string = (named?.[1] ?? '').trim();
    if (!EMAIL.test(email)) {
        throw usageError(`"${raw}" não é uma pessoa: use "Nome <email>" ou só o e-mail.`);
    }
    return { name: name === '' ? null : name, email, approver };
}

export function peopleOf(options: DocumentOptions): readonly NegotiationPerson[] {
    if (options.approver === undefined) {
        throw usageError('Diga quem aprova com --approver <email>: o de acordo dessa pessoa encerra a negociação.');
    }
    const approver: NegotiationPerson = personOf(options.approver, true);
    const people: Map<string, NegotiationPerson> = new Map<string, NegotiationPerson>();
    (options.person ?? []).forEach((raw: string) => {
        const person: NegotiationPerson = personOf(raw, false);
        people.set(person.email, person);
    });
    const listed: NegotiationPerson | undefined = people.get(approver.email);
    people.set(approver.email, { ...approver, name: approver.name ?? listed?.name ?? null });
    return [...people.values()];
}

function preview(
    document: DocumentView,
    version: VersionSummary,
    people: readonly NegotiationPerson[],
    message: string | null
): readonly string[] {
    return [
        `Começar a negociação de ${document.number ?? 'documento'} "${document.title}", versão ${String(version.version)}.`,
        `O Nexo manda um e-mail com o link do documento para ${String(people.length)} pessoa(s):`,
        ...people.map(
            (person: NegotiationPerson) =>
                `  - ${person.name === null ? '' : `${person.name} `}<${person.email}>${person.approver ? '  (aprova)' : ''}`
        ),
        ...(message === null ? [] : [`Mensagem no e-mail: ${message}`])
    ];
}

export async function documentsNegotiate(context: CliContext, documentId: string, options: DocumentOptions): Promise<void> {
    const people: readonly NegotiationPerson[] = peopleOf(options);
    const message: string | null = (options.message ?? '').trim() === '' ? null : (options.message ?? '').trim();
    const session: Session = sessionOf(context, options);
    const document: DocumentView = await documentOf(context, session, documentId);
    const version: VersionSummary = versionOf(document, options.versionNumber);
    preview(document, version, people, message).forEach((line: string) => {
        printLine(context, line);
    });
    if (!(await confirmed(context, options.yes, 'Enviar os e-mails?'))) {
        return;
    }
    const negotiation: unknown = await call(context, session, 'POST', `/documents/${encodeURIComponent(documentId)}/negotiation`, {
        people,
        message,
        versionId: version.id
    });
    if (options.json === true) {
        printJson(context, negotiation);
        return;
    }
    printLine(context, `Negociação aberta: ${String(people.length)} pessoa(s) receberam o link por e-mail.`);
}
