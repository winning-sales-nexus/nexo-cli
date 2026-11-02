import type { Command } from 'commander';
import {
    dashboardsCatalog,
    dashboardsInit,
    dashboardsList,
    dashboardsPull,
    dashboardsPush,
    dashboardsRun,
    dashboardsSave
} from './commands/dashboards.js';
import type { DashboardOptions } from './commands/dashboards.js';
import type { CliContext } from './context.js';

function addReadCommands(dashboards: Command, context: CliContext): void {
    dashboards
        .command('list')
        .description('Os painéis que você vê')
        .action(async (_options: DashboardOptions, command: Command) => {
            await dashboardsList(context, command.optsWithGlobals());
        });
    dashboards
        .command('catalog')
        .description('Busca fontes, campos e medidas que um relatório pode usar')
        .option('--text <termo>', 'palavras a buscar')
        .option('--source <fonte>', 'só uma fonte')
        .option('--limit <n>', 'quantos resultados')
        .action(async (_options: DashboardOptions, command: Command) => {
            await dashboardsCatalog(context, command.optsWithGlobals());
        });
    dashboards
        .command('run')
        .description('Os números de um relatório salvo, com o seu acesso')
        .argument('<relatório>', 'id do relatório')
        .argument('[pasta]', 'pasta do painel', '.')
        .option('--dashboard <id>', 'painel, no lugar do da pasta')
        .action(async (reportId: string, dir: string, _options: DashboardOptions, command: Command) => {
            await dashboardsRun(context, reportId, dir, command.optsWithGlobals());
        });
}

function addFileCommands(dashboards: Command, context: CliContext): void {
    dashboards
        .command('init')
        .description('Cria uma pasta com dashboard.json (um painel com uma aba vazia)')
        .argument('<pasta>', 'pasta nova do painel')
        .option('--name <nome>', 'nome do painel')
        .action((dir: string, _options: DashboardOptions, command: Command) => {
            dashboardsInit(context, dir, command.optsWithGlobals());
        });
    dashboards
        .command('pull')
        .description('Baixa um painel do Nexo para uma pasta nova')
        .argument('<painel>', 'id do painel (veja `nexo dashboards list`)')
        .argument('[pasta]', 'pasta nova (padrão: o id)')
        .action(async (id: string, dir: string | undefined, _options: DashboardOptions, command: Command) => {
            await dashboardsPull(context, id, dir, command.optsWithGlobals());
        });
}

function addSaveCommands(dashboards: Command, context: CliContext): void {
    dashboards
        .command('push')
        .description('Compara a pasta com o painel no Nexo, mostra a prévia e salva depois do sim')
        .argument('[pasta]', 'pasta do painel', '.')
        .option('-m, --summary <texto>', 'o que mudou, para o histórico de versões')
        .option('-y, --yes', 'salva logo depois de mostrar a prévia')
        .action(async (dir: string, _options: DashboardOptions, command: Command) => {
            await dashboardsPush(context, dir, command.optsWithGlobals());
        });
    dashboards
        .command('save')
        .description('Salva uma prévia já mostrada, depois do sim da pessoa')
        .argument('<prévia>', 'id da prévia que o push mostrou')
        .argument('[pasta]', 'pasta a atualizar com o painel salvo')
        .action(async (proposalId: string, dir: string | undefined, _options: DashboardOptions, command: Command) => {
            await dashboardsSave(context, proposalId, dir, command.optsWithGlobals());
        });
}

export function addDashboardCommands(program: Command, context: CliContext): void {
    const dashboards: Command = program
        .command('dashboards')
        .alias('paineis')
        .description('Painéis como código: o painel num arquivo do seu repositório');
    addReadCommands(dashboards, context);
    addFileCommands(dashboards, context);
    addSaveCommands(dashboards, context);
}
