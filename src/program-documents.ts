import { Option } from 'commander';
import type { Command } from 'commander';
import { documentsNegotiate } from './commands/document-negotiation.js';
import { templatesAdd, templatesDownload, templatesList } from './commands/document-templates.js';
import {
    documentsAccept,
    documentsCreate,
    documentsFile,
    documentsGet,
    documentsList,
    documentsQuestionnaire,
    documentsRevise
} from './commands/documents.js';
import type { DocumentOptions } from './commands/documents.js';
import type { CliContext } from './context.js';
import { DEFAULT_TIMEOUT_SECONDS } from './documents/journey-api.js';
import { DOCUMENT_AGENTS } from './documents/journey.types.js';

function collect(value: string, previous: readonly string[]): readonly string[] {
    return [...previous, value];
}

function agentOption(description: string = 'proposal (Proposta) ou contract (Contrato)'): Option {
    return new Option('--agent <agente>', description).choices([...DOCUMENT_AGENTS]);
}

function timeoutOption(): Option {
    return new Option('--timeout <segundos>', 'quanto esperar até desistir').default(DEFAULT_TIMEOUT_SECONDS);
}

function addTemplateCommands(documents: Command, context: CliContext): void {
    const templates: Command = documents
        .command('templates')
        .description('Os modelos de proposta ou de contrato que você pode usar')
        .addOption(agentOption())
        .action(async (_options: DocumentOptions, command: Command) => {
            await templatesList(context, command.optsWithGlobals());
        });
    templates
        .command('add')
        .description('Envia outro modelo (proposta: PDF, PPTX, DOCX ou HTML; contrato: DOCX, PDF ou HTML) e espera o Nexo ler')
        .argument('<arquivo>', 'o arquivo do modelo, até 15 MB (PDF: até 4 MB e 30 páginas)')
        .addOption(agentOption())
        .option('--no-wait', 'não espera a leitura do modelo')
        .addOption(timeoutOption())
        .action(async (path: string, _options: DocumentOptions, command: Command) => {
            await templatesAdd(context, path, command.optsWithGlobals());
        });
    templates
        .command('download')
        .description('Baixa o arquivo de origem de um modelo')
        .argument('<modelo>', 'id do modelo (veja `nexo documents templates`)')
        .addOption(agentOption())
        .option('-o, --output <arquivo>', 'onde gravar (padrão: o nome do arquivo, na pasta atual)')
        .action(async (templateId: string, _options: DocumentOptions, command: Command) => {
            await templatesDownload(context, templateId, command.optsWithGlobals());
        });
}

function addReadCommands(documents: Command, context: CliContext): void {
    documents
        .command('list')
        .description('As propostas e os contratos que você vê, do mais recente para o mais antigo')
        .addOption(agentOption('só os documentos deste agente'))
        .option('--deal <id>', 'só os documentos deste negócio')
        .action(async (_options: DocumentOptions, command: Command) => {
            await documentsList(context, command.optsWithGlobals());
        });
    documents
        .command('get')
        .description('Um documento com as versões e a situação de cada uma')
        .argument('<documento>', 'id do documento')
        .action(async (documentId: string, _options: DocumentOptions, command: Command) => {
            await documentsGet(context, documentId, command.optsWithGlobals());
        });
    documents
        .command('questionnaire')
        .description('O questionário de um negócio com um modelo: blocos, campos, valor, fonte e o que falta')
        .addOption(agentOption())
        .option('--deal <id>', 'o negócio do documento')
        .option('--template <id>', 'o modelo (veja `nexo documents templates`)')
        .option('--proposal <id>', 'contrato: a proposta pronta que entra como fonte dos valores')
        .option('--revising <documento>', 'o documento que vai ganhar uma versão nova: vem com as respostas da versão atual')
        .option('--no-reading', 'não lê as calls e o WhatsApp do negócio (a leitura usa a IA e conta no limite da empresa)')
        .option('-o, --output <arquivo>', 'grava o arquivo de respostas para editar e mandar com --answers')
        .action(async (_options: DocumentOptions, command: Command) => {
            await documentsQuestionnaire(context, command.optsWithGlobals());
        });
}

function addWritingCommands(documents: Command, context: CliContext): void {
    documents
        .command('create')
        .description('Manda as respostas e pede a escrita do documento; espera a versão ficar pronta')
        .addOption(agentOption())
        .option('--deal <id>', 'o negócio do documento (padrão: o do arquivo de respostas)')
        .option('--template <id>', 'o modelo (padrão: o do arquivo de respostas)')
        .option('--proposal <id>', 'contrato: a proposta pronta que entra como fonte dos valores')
        .option('--answers <arquivo>', 'o arquivo de respostas (de `nexo documents questionnaire -o`)')
        .option('--document <arquivo.html>', 'manda o documento já escrito em HTML; o Nexo limpa e confere, sem rodar a IA')
        .option('--adaptations <arquivo.json>', 'contrato, com --document: a lista do que foi tirado ou adaptado em relação ao modelo')
        .option('--no-wait', 'não espera a escrita: só devolve os ids')
        .addOption(timeoutOption())
        .action(async (_options: DocumentOptions, command: Command) => {
            await documentsCreate(context, command.optsWithGlobals());
        });
    documents
        .command('revise')
        .description('Pede uma versão nova com um pedido de mudança; a anterior fica no histórico')
        .argument('<documento>', 'id do documento')
        .option('--request <pedido>', 'o pedido de mudança, como você diria: "deixa mais direto"')
        .option('--answers <arquivo>', 'as respostas que mudaram (de `nexo documents questionnaire --revising`)')
        .option('--template <id>', 'outro modelo para a versão nova')
        .option('--document <arquivo.html>', 'manda a versão nova já escrita em HTML; o Nexo limpa e confere')
        .option('--adaptations <arquivo.json>', 'contrato, com --document: a lista do que foi tirado ou adaptado')
        .option('--no-wait', 'não espera a escrita: só devolve os ids')
        .addOption(timeoutOption())
        .action(async (documentId: string, _options: DocumentOptions, command: Command) => {
            await documentsRevise(context, documentId, command.optsWithGlobals());
        });
}

function addOutputCommands(documents: Command, context: CliContext): void {
    documents
        .command('accept')
        .description('Aceita uma versão da proposta: ela deixa de ser rascunho (o contrato não tem este passo)')
        .argument('<documento>', 'id do documento')
        .option('--version-number <n>', 'o número da versão (padrão: a atual)')
        .action(async (documentId: string, _options: DocumentOptions, command: Command) => {
            await documentsAccept(context, documentId, command.optsWithGlobals());
        });
    for (const kind of ['pdf', 'docx'] as const) {
        documents
            .command(kind)
            .description(kind === 'pdf' ? 'Baixa o PDF de uma versão pronta' : 'Baixa o DOCX de uma versão pronta de um contrato')
            .argument('<documento>', 'id do documento')
            .option('--version-number <n>', 'o número da versão (padrão: a atual)')
            .option('-o, --output <arquivo>', 'onde gravar (padrão: o nome que o Nexo dá, na pasta atual)')
            .action(async (documentId: string, _options: DocumentOptions, command: Command) => {
                await documentsFile(context, kind, documentId, command.optsWithGlobals());
            });
    }
}

function addNegotiationCommand(documents: Command, context: CliContext): void {
    documents
        .command('negotiate')
        .description('Começa a negociação: mostra quem recebe o e-mail com o link e pede o sim')
        .argument('<documento>', 'id do documento')
        .option('--person <pessoa>', 'quem recebe o link: "Nome <email>" ou só o e-mail (repita, até 10 pessoas)', collect, [])
        .option('--approver <email>', 'quem dá o de acordo que encerra a negociação (exatamente uma pessoa)')
        .option('--message <texto>', 'mensagem que vai no e-mail')
        .option('--version-number <n>', 'o número da versão a enviar (padrão: a atual)')
        .option('-y, --yes', 'envia depois de mostrar, sem perguntar (só depois do sim da pessoa)')
        .action(async (documentId: string, _options: DocumentOptions, command: Command) => {
            await documentsNegotiate(context, documentId, command.optsWithGlobals());
        });
}

export function addDocumentCommands(program: Command, context: CliContext): void {
    const documents: Command = program
        .command('documents')
        .alias('documentos')
        .description('Propostas e contratos: modelos, questionário, escrita, versões, PDF, DOCX e negociação');
    addTemplateCommands(documents, context);
    addReadCommands(documents, context);
    addWritingCommands(documents, context);
    addOutputCommands(documents, context);
    addNegotiationCommand(documents, context);
}
