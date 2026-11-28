import type { Command } from 'commander';
import { contextAdd, contextConfirm, contextRemove, contextSet, contextShow } from './commands/context-company.js';
import type { ContextOptions } from './commands/context-company.js';
import type { CliContext } from './context.js';

const BLOCK_HELP: string = 'empresa, icp, persona, proposta_de_valor, posicionamento, oferta ou prova';
const WRITE_NOTE: string =
    'Só admin, com o escopo context:write, que precisa ser pedido pelo nome no login (nexo login --scopes <os que você usa>,context:write)';

function addWriteOptions(command: Command, withValue: boolean): Command {
    if (withValue) {
        command.option('--value-json', 'o valor é JSON (objeto, lista, número); sem isso é texto');
    }
    return command
        .option('--change-confirmed', 'confirma que quer mudar um bloco que a empresa já confirmou')
        .option('-y, --yes', 'grava logo depois de mostrar a prévia');
}

function addValueCommands(group: Command, context: CliContext): void {
    addWriteOptions(
        group
            .command('set')
            .description(`Muda um campo, com a prévia de antes e depois e o sim. ${WRITE_NOTE}`)
            .argument('<bloco>', BLOCK_HELP)
            .argument('<campo>', 'caminho do campo, como offerings.0.whatItIs (veja `nexo context show`)')
            .argument('<valor>', 'o texto novo inteiro'),
        true
    ).action(async (block: string, field: string, value: string, _options: ContextOptions, command: Command) => {
        await contextSet(context, block, field, value, command.optsWithGlobals());
    });
    addWriteOptions(
        group
            .command('add')
            .description(`Soma um item a uma lista, com a prévia e o sim. ${WRITE_NOTE}`)
            .argument('<bloco>', BLOCK_HELP)
            .argument('<lista>', 'caminho da lista, como offerings')
            .argument('<valor>', 'o item: um texto, ou com --value-json o objeto inteiro'),
        true
    ).action(async (block: string, field: string, value: string, _options: ContextOptions, command: Command) => {
        await contextAdd(context, block, field, value, command.optsWithGlobals());
    });
}

function addRemoveCommands(group: Command, context: CliContext): void {
    addWriteOptions(
        group
            .command('remove')
            .description(`Tira um item de uma lista, com a prévia e o sim. ${WRITE_NOTE}`)
            .argument('<bloco>', BLOCK_HELP)
            .argument('<lista>', 'caminho da lista, como offerings')
            .argument('[item]', 'o texto exato do item (para uma posição, use --index)')
            .option('--index <n>', 'a posição do item na lista, a partir de 0, no lugar do texto'),
        false
    ).action(async (block: string, field: string, item: string | undefined, _options: ContextOptions, command: Command) => {
        await contextRemove(context, block, field, item, command.optsWithGlobals());
    });
    addWriteOptions(
        group
            .command('confirm')
            .description(`Confirma o rascunho de um bloco como está, com a prévia e o sim. ${WRITE_NOTE}`)
            .argument('<bloco>', BLOCK_HELP),
        false
    ).action(async (block: string, _options: ContextOptions, command: Command) => {
        await contextConfirm(context, block, command.optsWithGlobals());
    });
}

export function addContextCommands(program: Command, context: CliContext): void {
    const group: Command = program
        .command('context')
        .alias('contexto')
        .description('O contexto da empresa (empresa, ICP, persona, proposta de valor, posicionamento, oferta e prova): ler e editar');
    group
        .command('show', { isDefault: true })
        .description('Lê o contexto, bloco por bloco, com a origem de cada campo (precisa de context:read)')
        .argument('[bloco]', `só um bloco: ${BLOCK_HELP}`)
        .action(async (block: string | undefined, _options: ContextOptions, command: Command) => {
            await contextShow(context, block, command.optsWithGlobals());
        });
    addValueCommands(group, context);
    addRemoveCommands(group, context);
}
