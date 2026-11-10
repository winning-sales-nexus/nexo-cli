import { printJson, printLine, printNotice, sessionOf } from '../context.js';
import type { CliContext, GlobalOptions } from '../context.js';
import type { Session } from '../config/session.js';
import { CliError, usageError } from '../errors.js';
import { EXIT_CODES } from '../exit-codes.types.js';
import { answersFileOf, changedAnswers, readAnswersFile, readJsonFile, writeAnswersFile } from '../documents/answers-file.js';
import type { AnswersFile, GroupChange, SentAnswer } from '../documents/answers-file.js';
import { agentOf, call, documentOf, failureOf, statusLabel, timeoutOf, versionOf, waitForVersion } from '../documents/journey-api.js';
import type {
    DocumentAgent,
    DocumentSummary,
    DocumentView,
    FileLink,
    QuestionnaireResponse,
    VersionSummary,
    WritingReceipt
} from '../documents/journey.types.js';
import { describeDocument, describeQuestionnaire, documentRow } from '../documents/summary.js';
import { download, readText, targetOf } from '../documents/transfer.js';

export interface DocumentOptions extends GlobalOptions {
    readonly agent?: string;
    readonly deal?: string;
    readonly template?: string;
    readonly proposal?: string;
    readonly revising?: string;
    readonly reading?: boolean;
    readonly answers?: string;
    readonly document?: string;
    readonly adaptations?: string;
    readonly request?: string;
    readonly wait?: boolean;
    readonly timeout?: string;
    readonly versionNumber?: string;
    readonly output?: string;
    readonly person?: readonly string[];
    readonly approver?: string;
    readonly message?: string;
    readonly yes?: boolean;
}

interface Start {
    readonly agent: DocumentAgent;
    readonly dealId: string | null;
    readonly templateId: string | null;
    readonly proposalDocumentId: string | null;
    readonly documentId: string | null;
}

interface Answered {
    readonly answers: readonly SentAnswer[];
    readonly groups: readonly GroupChange[];
    readonly notes?: string;
}

function needsTemplate(templateId: string | null): string {
    if (templateId === null) {
        throw usageError('Diga o modelo com --template <id>.', 'Veja os modelos com `nexo documents templates --agent proposal|contract`.');
    }
    return templateId;
}

function firstOf(...values: readonly (string | null | undefined)[]): string | null {
    return values.find((value: string | null | undefined) => value !== null && value !== undefined) ?? null;
}

function newStart(options: DocumentOptions, file: AnswersFile | null): Start {
    return {
        agent: agentOf(firstOf(options.agent, file?.agent)),
        dealId: firstOf(options.deal, file?.dealId),
        templateId: needsTemplate(firstOf(options.template, file?.templateId)),
        proposalDocumentId: firstOf(options.proposal, file?.proposalDocumentId),
        documentId: null
    };
}

async function revisionStart(context: CliContext, session: Session, documentId: string, options: DocumentOptions): Promise<Start> {
    const document: DocumentView = await documentOf(context, session, documentId);
    return {
        agent: document.agent,
        dealId: document.dealId,
        templateId: options.template ?? null,
        proposalDocumentId: null,
        documentId: document.id
    };
}

async function questionnaireOf(context: CliContext, session: Session, start: Start, dealReading: boolean): Promise<QuestionnaireResponse> {
    const { agent, ...body }: Start = start;
    return (await call(context, session, 'POST', `/${agent}/questionnaire`, { ...body, dealReading })) as QuestionnaireResponse;
}

async function answeredOf(context: CliContext, session: Session, start: Start, file: AnswersFile | null): Promise<Answered> {
    if (file === null) {
        return { answers: [], groups: [] };
    }
    const baseline: QuestionnaireResponse = await questionnaireOf(context, session, start, false);
    return {
        answers: changedAnswers(file, baseline.questionnaire),
        groups: file.groups,
        ...(file.notes === null || file.notes.trim() === '' ? {} : { notes: file.notes })
    };
}

function writtenOf(options: DocumentOptions): { readonly html?: string; readonly adaptations?: unknown } {
    if (options.document === undefined) {
        if (options.adaptations !== undefined) {
            throw usageError('--adaptations só vale com --document, o documento já escrito.');
        }
        return {};
    }
    const html: string = readText(options.document);
    if (html.trim() === '') {
        throw usageError(`${options.document} está vazio.`);
    }
    return { html, ...(options.adaptations === undefined ? {} : { adaptations: readJsonFile(options.adaptations) }) };
}

function fileOf(options: DocumentOptions): AnswersFile | null {
    return options.answers === undefined ? null : readAnswersFile(options.answers);
}

export async function documentsList(context: CliContext, options: DocumentOptions): Promise<void> {
    const query: URLSearchParams = new URLSearchParams();
    if (options.agent !== undefined) {
        query.set('agent', agentOf(options.agent));
    }
    if (options.deal !== undefined) {
        query.set('dealId', options.deal);
    }
    const body: { readonly items: readonly DocumentSummary[] } = (await call(
        context,
        sessionOf(context, options),
        'GET',
        `/documents${query.size === 0 ? '' : `?${query.toString()}`}`
    )) as { readonly items: readonly DocumentSummary[] };
    if (options.json === true) {
        printJson(context, body);
        return;
    }
    if (body.items.length === 0) {
        printLine(context, 'Nenhum documento.');
        return;
    }
    body.items.forEach((document: DocumentSummary) => {
        printLine(context, documentRow(document));
    });
}

export async function documentsGet(context: CliContext, documentId: string, options: DocumentOptions): Promise<void> {
    const document: DocumentView = await documentOf(context, sessionOf(context, options), documentId);
    if (options.json === true) {
        printJson(context, document);
        return;
    }
    describeDocument(document).forEach((line: string) => {
        printLine(context, line);
    });
    if (document.current?.status === 'failed') {
        failureOf(document.current).forEach((line: string) => {
            printLine(context, line);
        });
    }
}

export async function documentsQuestionnaire(context: CliContext, options: DocumentOptions): Promise<void> {
    const session: Session = sessionOf(context, options);
    const start: Start =
        options.revising === undefined ? newStart(options, null) : await revisionStart(context, session, options.revising, options);
    const response: QuestionnaireResponse = await questionnaireOf(context, session, start, options.reading !== false);
    if (options.output !== undefined) {
        writeAnswersFile(options.output, answersFileOf(response.questionnaire));
    }
    if (options.json === true) {
        printJson(context, response);
        return;
    }
    describeQuestionnaire(response).forEach((line: string) => {
        printLine(context, line);
    });
    if (options.output !== undefined) {
        printNotice(context, `Respostas em ${options.output}: edite o "text" de cada resposta e mande com --answers ${options.output}.`);
    }
}

function reportReceipt(context: CliContext, receipt: WritingReceipt, version: VersionSummary | null, options: DocumentOptions): void {
    if (options.json === true) {
        printJson(context, {
            ...receipt,
            ...(version === null
                ? {}
                : {
                      status: version.status,
                      failureReason: version.failureReason,
                      findings: [...version.valueFindings, ...version.checkFindings],
                      changeSummary: version.changeSummary
                  })
        });
        return;
    }
    const status: string = statusLabel(version?.status ?? receipt.status);
    printLine(context, `${receipt.documentId}  ${receipt.number ?? '—'}  versão ${String(receipt.version)} ${status}  ${receipt.title}`);
    if (version?.changeSummary !== null && version?.changeSummary !== undefined) {
        printLine(context, `O que mudou: ${version.changeSummary}`);
    }
}

function failed(context: CliContext, version: VersionSummary): CliError {
    const [headline, ...findings]: readonly string[] = failureOf(version);
    findings.forEach((line: string) => {
        printNotice(context, line);
    });
    return new CliError(
        headline ?? 'A versão não saiu.',
        EXIT_CODES.failure,
        'Corrija a resposta e peça uma versão nova com `nexo documents revise`.'
    );
}

async function followReceipt(context: CliContext, session: Session, receipt: WritingReceipt, options: DocumentOptions): Promise<void> {
    if (receipt.status === 'ready') {
        reportReceipt(context, receipt, null, options);
        return;
    }
    if (options.wait === false) {
        reportReceipt(context, receipt, null, options);
        printNotice(context, `Acompanhe com \`nexo documents get ${receipt.documentId}\`.`);
        return;
    }
    const version: VersionSummary = await waitForVersion(context, session, receipt, timeoutOf(options.timeout));
    reportReceipt(context, receipt, version, options);
    if (version.status === 'failed') {
        throw failed(context, version);
    }
}

export async function documentsCreate(context: CliContext, options: DocumentOptions): Promise<void> {
    const session: Session = sessionOf(context, options);
    const file: AnswersFile | null = fileOf(options);
    const written: { readonly html?: string } = writtenOf(options);
    const start: Start = newStart(options, file);
    const { agent, documentId: _none, ...body }: Start = start;
    const receipt: WritingReceipt = (await call(
        context,
        session,
        'POST',
        `/${agent}/documents${written.html === undefined ? '' : '/written'}`,
        {
            ...body,
            ...(await answeredOf(context, session, start, file)),
            ...written
        }
    )) as WritingReceipt;
    await followReceipt(context, session, receipt, options);
}

export async function documentsRevise(context: CliContext, documentId: string, options: DocumentOptions): Promise<void> {
    const request: string = (options.request ?? '').trim();
    const file: AnswersFile | null = fileOf(options);
    if (request === '' && file === null) {
        throw usageError('Diga o que muda: --request "o pedido", ou --answers com as respostas que mudaram.');
    }
    const written: { readonly html?: string } = writtenOf(options);
    const session: Session = sessionOf(context, options);
    const answered: Answered =
        file === null
            ? { answers: [], groups: [] }
            : await answeredOf(context, session, await revisionStart(context, session, documentId, options), file);
    const receipt: WritingReceipt = (await call(
        context,
        session,
        'POST',
        `/documents/${encodeURIComponent(documentId)}/versions${written.html === undefined ? '' : '/written'}`,
        { templateId: options.template ?? null, request: request === '' ? null : request, ...answered, ...written }
    )) as WritingReceipt;
    await followReceipt(context, session, receipt, options);
}

export async function documentsAccept(context: CliContext, documentId: string, options: DocumentOptions): Promise<void> {
    const session: Session = sessionOf(context, options);
    const version: VersionSummary = versionOf(await documentOf(context, session, documentId), options.versionNumber);
    const accepted: unknown = await call(
        context,
        session,
        'POST',
        `/documents/${encodeURIComponent(documentId)}/versions/${version.id}/acceptance`
    );
    if (options.json === true) {
        printJson(context, accepted);
        return;
    }
    printLine(context, `Versão ${String(version.version)} aceita: a proposta deixou de ser rascunho.`);
    printNotice(
        context,
        `Baixe com \`nexo documents pdf ${documentId}\` ou comece a negociação com \`nexo documents negotiate ${documentId}\`.`
    );
}

export async function documentsFile(
    context: CliContext,
    kind: 'pdf' | 'docx',
    documentId: string,
    options: DocumentOptions
): Promise<void> {
    const session: Session = sessionOf(context, options);
    const document: DocumentView = await documentOf(context, session, documentId);
    const version: VersionSummary = versionOf(document, options.versionNumber);
    const link: FileLink = (await call(
        context,
        session,
        'POST',
        `/documents/${encodeURIComponent(documentId)}/versions/${version.id}/${kind}`
    )) as FileLink;
    const target: string = targetOf(options.output, link.fileName, `${document.number ?? document.id}-v${String(version.version)}.${kind}`);
    await download(context, link.url, target);
    if (options.json === true) {
        printJson(context, { documentId, versionId: version.id, version: version.version, path: target });
        return;
    }
    printLine(context, target);
}
