import { printJson, printLine, printNotice, sessionOf } from '../context.js';
import type { CliContext } from '../context.js';
import type { Session } from '../config/session.js';
import { CliError } from '../errors.js';
import { EXIT_CODES } from '../exit-codes.types.js';
import { agentOf, call, poll, timeoutOf } from '../documents/journey-api.js';
import type { DocumentAgent, FileLink, TemplateChoice, TemplateChoices, TemplateUpload, UploadTicket } from '../documents/journey.types.js';
import { templateRow } from '../documents/summary.js';
import { download, localFile, targetOf, upload } from '../documents/transfer.js';
import type { LocalFile } from '../documents/transfer.js';
import type { DocumentOptions } from './documents.js';

const READING_LABELS: Readonly<Record<TemplateUpload['state'], string>> = {
    reading: 'o Nexo está lendo o modelo',
    ready: 'modelo lido',
    failed: 'a leitura não saiu'
};

export async function templatesList(context: CliContext, options: DocumentOptions): Promise<void> {
    const agent: DocumentAgent = agentOf(options.agent);
    const choices: TemplateChoices = (await call(context, sessionOf(context, options), 'GET', `/${agent}/templates`)) as TemplateChoices;
    if (options.json === true) {
        printJson(context, choices);
        return;
    }
    if (choices.templates.length === 0) {
        printLine(context, 'Nenhum modelo.');
        printNotice(context, `Sem modelo não há documento: envie um com \`nexo documents templates add <arquivo> --agent ${agent}\`.`);
        return;
    }
    choices.templates.forEach((template: TemplateChoice) => {
        printLine(context, templateRow(template));
    });
}

async function readTemplate(
    context: CliContext,
    session: Session,
    agent: DocumentAgent,
    template: TemplateUpload,
    options: DocumentOptions
): Promise<TemplateUpload> {
    if (options.wait === false || template.state !== 'reading') {
        return template;
    }
    return poll(context, {
        read: async () => (await call(context, session, 'GET', `/${agent}/templates/${template.id}`)) as TemplateUpload,
        stateOf: (each: TemplateUpload) => each.state,
        describe: (each: TemplateUpload) => `${each.name}: ${READING_LABELS[each.state]}.`,
        settled: (each: TemplateUpload) => each.state !== 'reading',
        timeoutMs: timeoutOf(options.timeout),
        late: new CliError(
            'O Nexo ainda está lendo o modelo.',
            EXIT_CODES.failure,
            `Ele aparece em \`nexo documents templates --agent ${agent}\`; o questionário abre quando a leitura terminar.`
        )
    });
}

export async function templatesAdd(context: CliContext, path: string, options: DocumentOptions): Promise<void> {
    const agent: DocumentAgent = agentOf(options.agent);
    const file: LocalFile = localFile(path);
    const session: Session = sessionOf(context, options);
    const ticket: UploadTicket = (await call(context, session, 'POST', `/${agent}/templates/uploads`, {
        fileName: file.fileName,
        sizeInBytes: file.bytes.length
    })) as UploadTicket;
    await upload(context, ticket, file);
    const confirmed: TemplateUpload = (await call(context, session, 'POST', `/${agent}/templates/uploads/${ticket.uploadId}/confirm`, {
        fileName: file.fileName
    })) as TemplateUpload;
    const template: TemplateUpload = await readTemplate(context, session, agent, confirmed, options);
    if (options.json === true) {
        printJson(context, template);
    }
    if (template.state === 'failed') {
        throw new CliError(`O Nexo não conseguiu ler o modelo: ${template.failure ?? 'motivo não informado'}.`, EXIT_CODES.failure);
    }
    if (options.json === true) {
        return;
    }
    printLine(context, `${template.id}  ${template.name}  ${READING_LABELS[template.state]}`);
    printNotice(
        context,
        template.shared ? 'O modelo já vale para a empresa.' : 'O modelo vale só para você até um admin ou líder liberar para a empresa.'
    );
}

export async function templatesDownload(context: CliContext, templateId: string, options: DocumentOptions): Promise<void> {
    const agent: DocumentAgent = agentOf(options.agent);
    const link: FileLink = (await call(
        context,
        sessionOf(context, options),
        'GET',
        `/${agent}/templates/${encodeURIComponent(templateId)}/source`
    )) as FileLink;
    const target: string = targetOf(options.output, link.fileName, `modelo-${templateId}`);
    await download(context, link.url, target);
    if (options.json === true) {
        printJson(context, { templateId, path: target });
        return;
    }
    printLine(context, target);
}
