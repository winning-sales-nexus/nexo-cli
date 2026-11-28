import type { Command } from 'commander';
import {
    brainAreas,
    brainBlindTest,
    brainChoose,
    brainCreate,
    brainEdit,
    brainFromTemplate,
    brainList,
    brainMoments,
    brainRemove,
    brainTemplates
} from './commands/brain.js';
import type { BrainOptions } from './commands/brain.js';
import type { CliContext } from './context.js';

function collect(value: string, previous: readonly string[]): readonly string[] {
    return [...previous, value];
}

const LEVEL: string = '<nível>';
const LEVEL_HELP: string = 'company (empresa), area, team (time) ou person (pessoal)';

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
        .description('Lista as skills de um nível (a pessoal é só sua)')
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
        .option('--agent-role <papel>', 'só com o momento attendance_agent_turn: sdr (o padrão) ou cs')
        .option('--always <texto>', 'o que fazer sempre (repita para mais de um)', collect, [])
        .option('--never <texto>', 'o que nunca fazer (repita para mais de um)', collect, [])
        .option('--example <texto>', 'um exemplo de como deve sair, em uma linha')
        .action(async (level: string, _options: BrainOptions, command: Command) => {
            await brainCreate(context, level, command.optsWithGlobals());
        });
}

function addPersonCommands(brain: Command, context: CliContext): void {
    brain
        .command('templates')
        .description('Os modelos da Winning para skill pessoal, com os campos de cada um')
        .action(async (_options: BrainOptions, command: Command) => {
            await brainTemplates(context, command.optsWithGlobals());
        });
    brain
        .command('from-template')
        .description('Cria uma skill pessoal de um modelo: você preenche os campos, nunca o texto')
        .argument('<modelo>', 'id do modelo (nexo brain templates)')
        .option('--answer <campo=texto>', 'a resposta de um campo do modelo (repita; todos são obrigatórios)', collect, [])
        .action(async (templateId: string, _options: BrainOptions, command: Command) => {
            await brainFromTemplate(context, templateId, command.optsWithGlobals());
        });
    brain
        .command('blind-test')
        .description('Compara às cegas, para uma skill pessoal: dois textos A e B, sem dizer qual tem a skill')
        .argument('<skill>', 'id da skill pessoal')
        .action(async (skillId: string, _options: BrainOptions, command: Command) => {
            await brainBlindTest(context, skillId, command.optsWithGlobals());
        });
    brain
        .command('choose')
        .description('Escolhe A ou B na comparação às cegas; só então diz qual tinha a skill')
        .argument('<comparação>', 'id da comparação (nexo brain blind-test)')
        .argument('<escolha>', 'a ou b')
        .action(async (choiceId: string, chosen: string, _options: BrainOptions, command: Command) => {
            await brainChoose(context, choiceId, chosen, command.optsWithGlobals());
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
        .description('Apaga uma skill de qualquer nível (a pessoal dá para restaurar em 30 dias, pelo app)')
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
    addPersonCommands(brain, context);
    addChangeCommands(brain, context);
}
