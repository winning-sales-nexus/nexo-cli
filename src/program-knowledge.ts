import type { Command } from 'commander';
import {
    itemsCreate,
    itemsEdit,
    itemsList,
    itemsMove,
    itemsRemove,
    itemsResolve,
    itemsSwitch,
    themesCreate,
    themesList,
    themesRemove,
    themesRename
} from './commands/knowledge.js';
import type { KnowledgeOptions } from './commands/knowledge.js';
import type { CliContext } from './context.js';

const TYPE_HELP: string = 'rule, practice, product_fact, price, proof ou standard';

function addItemReads(items: Command, context: CliContext): void {
    items
        .command('list')
        .description('Lista os itens, com o tema de cada um')
        .option('--type <tipo>', `só os itens deste tipo (${TYPE_HELP})`)
        .option('--theme <id>', 'só os itens deste tema (a CLI percorre as páginas e filtra)')
        .option('--needs-you', 'só os pendentes')
        .option('--page <n>', 'a página')
        .option('--page-size <n>', 'itens por página (até 100)')
        .action(async (_options: KnowledgeOptions, command: Command) => {
            await itemsList(context, command.optsWithGlobals());
        });
}

function withRuleOptions(command: Command): Command {
    return command
        .option(
            '--subject <assunto>',
            'campos da regra (type rule): discount, minimum_price, deadline, payment_terms, integration, scope ou implementation'
        )
        .option('--condition <texto>', 'regra: a condição que ativa')
        .option('--limit <texto>', 'regra: o valor do limite')
        .option('--exception <texto>', 'regra: a exceção conhecida')
        .option('--approver <texto>', 'regra: quem aprova a exceção');
}

function addItemCreateEdit(items: Command, context: CliContext): void {
    withRuleOptions(
        items
            .command('create')
            .description('Escreve um item à mão; entra em uso na hora')
            .option('--type <tipo>', TYPE_HELP)
            .option('--text <texto>', 'o texto curto do item')
            .option('--theme <id>', 'o tema do item (sem ele, o tema padrão)')
    ).action(async (_options: KnowledgeOptions, command: Command) => {
        await itemsCreate(context, command.optsWithGlobals());
    });
    withRuleOptions(
        items
            .command('edit')
            .description('Edita um item: texto, tipo, tema ou campos da regra')
            .argument('<item>', 'id do item')
            .option('--text <texto>', 'o texto novo')
            .option('--type <tipo>', `o tipo novo (${TYPE_HELP})`)
            .option('--theme <id>', 'o tema novo (nexo knowledge themes list)')
    ).action(async (itemId: string, _options: KnowledgeOptions, command: Command) => {
        await itemsEdit(context, itemId, command.optsWithGlobals());
    });
}

function addItemStates(items: Command, context: CliContext): void {
    for (const on of [true, false]) {
        items
            .command(on ? 'on' : 'off')
            .description(on ? 'Liga um item desligado: volta a ficar em uso' : 'Desliga um item: sai de uso, sem apagar')
            .argument('<item>', 'id do item')
            .action(async (itemId: string, _options: KnowledgeOptions, command: Command) => {
                await itemsSwitch(context, itemId, on, command.optsWithGlobals());
            });
    }
    items
        .command('resolve')
        .description(
            'Resolve uma pendência: choose (este lado do conflito), approve (aprova a prova), use (aceita como está), rewrite, discard'
        )
        .argument('<item>', 'id do item')
        .option('--action <ação>', 'choose, approve, use, rewrite ou discard')
        .option('--text <texto>', 'o texto novo (só com rewrite)')
        .option('-y, --yes', 'descarta sem perguntar (só depois do sim da pessoa)')
        .action(async (itemId: string, _options: KnowledgeOptions, command: Command) => {
            await itemsResolve(context, itemId, command.optsWithGlobals());
        });
    items
        .command('remove')
        .description('Remove um item de vez; para tirar de uso por um tempo, use off')
        .argument('<item>', 'id do item')
        .option('-y, --yes', 'remove sem perguntar (só depois do sim da pessoa)')
        .action(async (itemId: string, _options: KnowledgeOptions, command: Command) => {
            await itemsRemove(context, itemId, command.optsWithGlobals());
        });
}

function addItemWrites(items: Command, context: CliContext): void {
    addItemCreateEdit(items, context);
    addItemStates(items, context);
    items
        .command('move')
        .description('Move até 100 itens para um tema; um id que não existe recusa tudo')
        .argument('<item...>', 'ids dos itens')
        .option('--theme <id>', 'o tema de destino')
        .action(async (itemIds: string[], _options: KnowledgeOptions, command: Command) => {
            await itemsMove(context, itemIds, command.optsWithGlobals());
        });
}

function addThemeCommands(knowledge: Command, context: CliContext): void {
    const themes: Command = knowledge.command('themes').description('Os temas da Base');
    themes
        .command('list')
        .description('Lista os temas, com o que cada um guarda')
        .action(async (_options: KnowledgeOptions, command: Command) => {
            await themesList(context, command.optsWithGlobals());
        });
    themes
        .command('create')
        .description('Cria um tema')
        .argument('<nome>', 'o nome do tema')
        .action(async (name: string, _options: KnowledgeOptions, command: Command) => {
            await themesCreate(context, name, command.optsWithGlobals());
        });
    themes
        .command('rename')
        .description('Renomeia um tema')
        .argument('<tema>', 'id do tema')
        .argument('<nome>', 'o nome novo')
        .action(async (themeId: string, name: string, _options: KnowledgeOptions, command: Command) => {
            await themesRename(context, themeId, name, command.optsWithGlobals());
        });
    themes
        .command('remove')
        .description('Apaga um tema vazio (com conteúdo, a API recusa com 409)')
        .argument('<tema>', 'id do tema')
        .option('-y, --yes', 'apaga sem perguntar (só depois do sim da pessoa)')
        .action(async (themeId: string, _options: KnowledgeOptions, command: Command) => {
            await themesRemove(context, themeId, command.optsWithGlobals());
        });
}

function addItemCommands(knowledge: Command, context: CliContext): void {
    const items: Command = knowledge
        .command('items')
        .description('Os itens da Base: lista, cria, edita (texto, tipo, tema) e move de tema');
    addItemReads(items, context);
    addItemWrites(items, context);
}

export function addKnowledgeCommands(program: Command, context: CliContext): void {
    const knowledge: Command = program
        .command('knowledge')
        .alias('base')
        .description('A Base de conhecimento: itens e temas. Só admin, com o escopo calibration:write para escrever');
    addItemCommands(knowledge, context);
    addThemeCommands(knowledge, context);
}
