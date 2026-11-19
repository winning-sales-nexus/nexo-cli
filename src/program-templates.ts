import { Option } from 'commander';
import type { Command } from 'commander';
import {
    templatesChange,
    templatesCreate,
    templatesGet,
    templatesList,
    templatesPreview,
    templatesPublish,
    templatesStructure
} from './commands/templates.js';
import type { TemplateOptions } from './commands/templates.js';
import type { CliContext } from './context.js';

function writeOptions(command: Command): Command {
    return command
        .option('--input <arquivo>', 'o pedido em JSON, de um arquivo ou - para o stdin; as opções abaixo valem mais')
        .option('--name <nome>', 'o nome do modelo, único no canal')
        .option('--subject <texto>', 'o assunto do e-mail')
        .option('--text <texto>', 'o texto do WhatsApp, ou do e-mail sem blocos')
        .option('--footer <texto>', 'o rodapé do WhatsApp; texto vazio tira')
        .option('--header <texto>', 'o cabeçalho de texto do WhatsApp; texto vazio tira')
        .addOption(new Option('--category <categoria>', 'a categoria do WhatsApp na Meta').choices(['marketing', 'utilidade']))
        .addOption(
            new Option('--record <registro>', 'o registro da regra que vai usar o modelo').choices([
                'negocio',
                'lead',
                'contato',
                'empresa',
                'reuniao'
            ])
        )
        .option('--blocks <arquivo>', 'os blocos do e-mail em JSON (a lista completa), de um arquivo ou - para o stdin')
        .option('--no-structure', 'e-mail sem logo, faixas nem cabeçalho da marca (só quando a pessoa pede)')
        .option('--html <arquivo>', 'grava o HTML da prévia do e-mail')
        .option('-y, --yes', 'grava depois de mostrar, sem perguntar (só depois do sim da pessoa)');
}

function addReadCommands(templates: Command, context: CliContext): void {
    templates
        .command('list')
        .description('Os modelos da empresa, com o canal, o estado e a versão')
        .addOption(new Option('--channel <canal>', 'só deste canal').choices(['email', 'whatsapp']))
        .addOption(new Option('--state <estado>', 'só neste estado').choices(['draft', 'ready', 'archived']))
        .addOption(
            new Option('--subject-type <tipo>', 'o registro da regra, para ver quais modelos servem').choices([
                'deal',
                'lead',
                'contact',
                'company',
                'meeting'
            ])
        )
        .action(async (_options: TemplateOptions, command: Command) => {
            await templatesList(context, command.optsWithGlobals());
        });
    templates
        .command('get')
        .description('Um modelo: o conteúdo, o formato (com a marca ou antigo) e as regras que o usam; --json traz os blocos')
        .argument('<modelo>', 'id do modelo')
        .action(async (templateId: string, _options: TemplateOptions, command: Command) => {
            await templatesGet(context, templateId, command.optsWithGlobals());
        });
}

function addPreviewCommands(templates: Command, context: CliContext): void {
    templates
        .command('preview')
        .description('A prévia do modelo com amostras fixas, a mesma do editor; nada é gravado')
        .argument('<modelo>', 'id do modelo')
        .option('--html <arquivo>', 'grava o HTML do e-mail, para abrir no navegador')
        .action(async (templateId: string, _options: TemplateOptions, command: Command) => {
            await templatesPreview(context, templateId, command.optsWithGlobals());
        });
    templates
        .command('structure')
        .description('Mostra um modelo de e-mail antigo na estrutura nova da marca; nada é gravado')
        .option('--template <id>', 'o modelo a estruturar')
        .option('--input <arquivo>', 'ou o conteúdo em JSON, de um arquivo ou - para o stdin')
        .option('--out <arquivo>', 'grava o conteúdo estruturado em JSON')
        .action(async (_options: TemplateOptions, command: Command) => {
            await templatesStructure(context, command.optsWithGlobals());
        });
}

function addWriteCommands(templates: Command, context: CliContext): void {
    writeOptions(
        templates
            .command('create')
            .description('Cria o rascunho de um modelo: mostra a prévia e o que falta da marca, e grava depois do sim')
            .addOption(new Option('--channel <canal>', 'o canal do modelo').choices(['email', 'whatsapp']))
    ).action(async (_options: TemplateOptions, command: Command) => {
        await templatesCreate(context, command.optsWithGlobals());
    });
    writeOptions(
        templates
            .command('change')
            .description('Muda o rascunho de um modelo (uma versão nova); o que não vem fica como está')
            .argument('<modelo>', 'id do modelo')
    ).action(async (templateId: string, _options: TemplateOptions, command: Command) => {
        await templatesChange(context, templateId, command.optsWithGlobals());
    });
    templates
        .command('publish')
        .description('Deixa o modelo pronto para usar (no WhatsApp, envia à Meta); mostra o cartão e grava depois do sim')
        .argument('<modelo>', 'id do modelo')
        .option('-y, --yes', 'publica depois de mostrar, sem perguntar (só depois do sim da pessoa)')
        .action(async (templateId: string, _options: TemplateOptions, command: Command) => {
            await templatesPublish(context, templateId, command.optsWithGlobals());
        });
}

export function addTemplateCommands(program: Command, context: CliContext): void {
    const templates: Command = program
        .command('templates')
        .alias('modelos')
        .description('Os modelos de mensagem (e-mail e WhatsApp), o e-mail com a marca da empresa');
    addReadCommands(templates, context);
    addPreviewCommands(templates, context);
    addWriteCommands(templates, context);
}
