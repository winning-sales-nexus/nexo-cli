import type { Command } from 'commander';
import { brainAreas, brainCreate, brainEdit, brainList, brainMoments, brainRemove } from './commands/brain.js';
import type { BrainOptions } from './commands/brain.js';
import type { CliContext } from './context.js';

function collect(value: string, previous: readonly string[]): readonly string[] {
    return [...previous, value];
}

const LEVEL: string = '<nível>';
const LEVEL_HELP: string = 'company (empresa), area ou team (time)';

function addReadCommands(brain: Command, context: CliContext): void {
    brain
        .command('areas')
        .description('As áreas da empresa (o id vai em --area)')
        .action(async (_options: BrainOptions, command: Command) => {
            await brainAreas(context, command.optsWithGlobals());
        });
    brain
        .command('moments')
        .description('Os momentos que aceitam skill nova (só os que têm o teste "não piora" funcionando)')
        .action(async (_options: BrainOptions, command: Command) => {
            await brainMoments(context, command.optsWithGlobals());
        });
    brain
        .command('list')
        .description('Lista as skills de área ou de time')
        .argument(LEVEL, LEVEL_HELP)
        .option('--scope <id>', 'só de uma área ou de um time')
        .action(async (level: string, _options: BrainOptions, command: Command) => {
            await brainList(context, level, command.optsWithGlobals());
        });
}

function addWriteCommands(brain: Command, context: CliContext): void {
    brain
        .command('create')
        .description('Cria uma skill pela ideia; o Cérebro escreve o SKILL.md e a skill nasce em teste. Só admin, com calibration:write')
        .argument(LEVEL, LEVEL_HELP)
        .option('--area <id>', 'a área da skill (nível area)')
        .option('--team <id>', 'o time da skill (nível team)')
        .option('--objective <texto>', 'o objetivo, em uma linha')
        .option('--moment <momento>', 'o momento da lista (nexo brain moments)')
        .option('--always <texto>', 'o que fazer sempre (repita para mais de um)', collect, [])
        .option('--never <texto>', 'o que nunca fazer (repita para mais de um)', collect, [])
        .option('--example <texto>', 'um exemplo de como deve sair, em uma linha')
        .action(async (level: string, _options: BrainOptions, command: Command) => {
            await brainCreate(context, level, command.optsWithGlobals());
        });
}

function addChangeCommands(brain: Command, context: CliContext): void {
    brain
        .command('edit')
        .description('Edita uma skill por item: soma, atualiza ou remove um item; nenhuma outra linha muda')
        .argument(LEVEL, LEVEL_HELP)
        .argument('<skill>', 'id da skill')
        .option('--add-always <texto>', 'soma um item em "sempre" (repita)', collect, [])
        .option('--add-never <texto>', 'soma um item em "nunca" (repita)', collect, [])
        .option('--update-always <troca>', 'troca um item de "sempre": "atual => novo" (repita)', collect, [])
        .option('--update-never <troca>', 'troca um item de "nunca": "atual => novo" (repita)', collect, [])
        .option('--remove-always <texto>', 'tira um item de "sempre" (repita)', collect, [])
        .option('--remove-never <texto>', 'tira um item de "nunca" (repita)', collect, [])
        .option('--confirm-shrink', 'confirma a edição que tira item ou encolhe a skill em mais de 30%')
        .action(async (level: string, skillId: string, _options: BrainOptions, command: Command) => {
            await brainEdit(context, level, skillId, command.optsWithGlobals());
        });
    brain
        .command('remove')
        .description('Apaga uma skill de área ou de time')
        .argument(LEVEL, LEVEL_HELP)
        .argument('<skill>', 'id da skill')
        .option('-y, --yes', 'apaga sem perguntar (só depois do sim da pessoa)')
        .action(async (level: string, skillId: string, _options: BrainOptions, command: Command) => {
            await brainRemove(context, level, skillId, command.optsWithGlobals());
        });
}

export function addBrainCommands(program: Command, context: CliContext): void {
    const brain: Command = program
        .command('brain')
        .alias('cerebro')
        .description('O Cérebro: as skills da empresa, das áreas e dos times, criadas pela ideia e editadas por item (nunca pelo texto)');
    addReadCommands(brain, context);
    addWriteCommands(brain, context);
    addChangeCommands(brain, context);
}
