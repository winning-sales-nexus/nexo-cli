import type { Command } from 'commander';
import {
    automationsCatalog,
    automationsInit,
    automationsList,
    automationsPublish,
    automationsPull,
    automationsPush,
    automationsRun,
    automationsRuns,
    automationsToggle
} from './commands/automations.js';
import type { AutomationOptions } from './commands/automations.js';
import type { CliContext } from './context.js';

function addFileCommands(automations: Command, context: CliContext): void {
    automations
        .command('init')
        .description('Cria uma pasta com automation.json (o documento da regra)')
        .argument('<pasta>', 'pasta nova da automação')
        .option('--name <nome>', 'nome da automação')
        .action((dir: string, _options: AutomationOptions, command: Command) => {
            automationsInit(context, dir, command.optsWithGlobals());
        });
    automations
        .command('pull')
        .description('Baixa uma automação do Nexo (o rascunho, ou a última versão salva)')
        .argument('<automação>', 'id da automação (veja `nexo automations list`)')
        .argument('[pasta]', 'pasta nova (padrão: o id)')
        .action(async (id: string, dir: string | undefined, _options: AutomationOptions, command: Command) => {
            await automationsPull(context, id, dir, command.optsWithGlobals());
        });
    automations
        .command('push')
        .description('Cria a automação ou salva o rascunho, e mostra os problemas que impedem publicar')
        .argument('[pasta]', 'pasta da automação', '.')
        .option('-m, --summary <texto>', 'o que mudou')
        .action(async (dir: string, _options: AutomationOptions, command: Command) => {
            await automationsPush(context, dir, command.optsWithGlobals());
        });
}

function addLiveCommands(automations: Command, context: CliContext): void {
    automations
        .command('publish')
        .description('Publica o rascunho: mostra o que vai ao ar e pede o sim')
        .argument('[pasta]', 'pasta da automação', '.')
        .option('-y, --yes', 'publica depois de mostrar, sem perguntar (só depois do sim da pessoa)')
        .option('--cancel-live-runs', 'cancela as execuções em andamento da versão anterior')
        .action(async (dir: string, _options: AutomationOptions, command: Command) => {
            await automationsPublish(context, dir, command.optsWithGlobals());
        });
    for (const action of ['pause', 'resume'] as const) {
        automations
            .command(action)
            .description(action === 'pause' ? 'Pausa a automação' : 'Liga de novo uma automação pausada')
            .argument('[pasta]', 'pasta da automação', '.')
            .action(async (dir: string, _options: AutomationOptions, command: Command) => {
                await automationsToggle(context, action, dir, command.optsWithGlobals());
            });
    }
}

function addHistoryCommands(automations: Command, context: CliContext): void {
    automations
        .command('runs')
        .description('As execuções, da mais nova para a mais antiga')
        .argument('[pasta]', 'pasta da automação', '.')
        .option('--state <estado>', 'queued, running, waiting, completed, failed ou canceled')
        .action(async (dir: string, _options: AutomationOptions, command: Command) => {
            await automationsRuns(context, dir, command.optsWithGlobals());
        });
    automations
        .command('run')
        .description('Uma execução, passo a passo')
        .argument('<execução>', 'id da execução')
        .action(async (runId: string, _options: AutomationOptions, command: Command) => {
            await automationsRun(context, runId, command.optsWithGlobals());
        });
}

export function addAutomationCommands(program: Command, context: CliContext): void {
    const automations: Command = program
        .command('automations')
        .alias('flows')
        .description('Automações como código: a regra num arquivo do seu repositório')
        .option('--automation <id>', 'usa esta automação no lugar da da pasta');
    automations
        .command('catalog')
        .description('Os gatilhos, as ações e os campos que uma regra pode usar')
        .action(async (_options: AutomationOptions, command: Command) => {
            await automationsCatalog(context, command.optsWithGlobals());
        });
    automations
        .command('list')
        .description('As automações da empresa')
        .action(async (_options: AutomationOptions, command: Command) => {
            await automationsList(context, command.optsWithGlobals());
        });
    addFileCommands(automations, context);
    addLiveCommands(automations, context);
    addHistoryCommands(automations, context);
}
