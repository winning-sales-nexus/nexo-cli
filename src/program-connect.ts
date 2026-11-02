import type { Command } from 'commander';
import { connectInit, connectPull, connectPush, connectStatus } from './commands/connect-files.js';
import type { ConnectFileOptions } from './commands/connect-files.js';
import {
    connectChange,
    connectList,
    connectRehearse,
    connectRun,
    connectRuns,
    connectSecretSet,
    connectSystems
} from './commands/connect-runs.js';
import type { ConnectRunOptions } from './commands/connect-runs.js';
import { CHANGES } from './connect/changes.types.js';
import type { ChangeKind } from './connect/changes.types.js';
import type { CliContext } from './context.js';

const CHANGE_DESCRIPTIONS: Readonly<Record<ChangeKind, string>> = {
    publish: 'Publica a versão em edição (prévia, e o sim de uma pessoa)',
    enable: 'Liga o conector: os gatilhos passam a rodar a versão publicada (prévia e sim)',
    pause: 'Pausa o conector (prévia e sim)'
};

function addFileCommands(connect: Command, context: CliContext): void {
    connect
        .command('init')
        .description('Cria uma pasta com connector.ts, manifest.json e os tipos do SDK')
        .argument('<pasta>', 'pasta nova do conector')
        .option('--system <slug>', 'sistema do catálogo (veja `nexo connect systems`)')
        .option('--name <nome>', 'nome do conector')
        .action(async (dir: string, _options: ConnectFileOptions, command: Command) => {
            await connectInit(context, dir, command.optsWithGlobals());
        });
    connect
        .command('pull')
        .description('Baixa uma versão de um conector do Nexo para uma pasta nova')
        .argument('<conector>', 'id do conector (veja `nexo connect list`)')
        .argument('[pasta]', 'pasta nova (padrão: o id)')
        .option('--seq <n>', 'versão (padrão: a em edição)')
        .action(async (id: string, dir: string | undefined, _options: ConnectFileOptions, command: Command) => {
            await connectPull(context, id, dir, command.optsWithGlobals());
        });
}

function addSyncCommands(connect: Command, context: CliContext): void {
    connect
        .command('push')
        .description('Sobe connector.ts e manifest.json como uma versão nova, em edição')
        .argument('[pasta]', 'pasta do conector', '.')
        .requiredOption('-m, --summary <texto>', 'o que mudou nesta versão')
        .action(async (dir: string, _options: ConnectFileOptions, command: Command) => {
            await connectPush(context, dir, command.optsWithGlobals());
        });
    connect
        .command('status')
        .description('Estado do conector no Nexo: versões, segredos faltando e hosts esperando')
        .argument('[pasta]', 'pasta do conector', '.')
        .action(async (dir: string, _options: ConnectFileOptions, command: Command) => {
            await connectStatus(context, dir, command.optsWithGlobals());
        });
}

function addRunCommands(connect: Command, context: CliContext): void {
    connect
        .command('rehearse')
        .description('Ensaia a versão em edição e mostra o resultado inteiro')
        .argument('[pasta]', 'pasta do conector', '.')
        .option('--full', 'ensaio completo, no lugar da amostra')
        .option('--no-wait', 'só começa o ensaio, sem esperar')
        .action(async (dir: string, _options: ConnectRunOptions, command: Command) => {
            await connectRehearse(context, dir, command.optsWithGlobals());
        });
    connect
        .command('runs')
        .description('As últimas execuções')
        .argument('[pasta]', 'pasta do conector', '.')
        .action(async (dir: string, _options: ConnectRunOptions, command: Command) => {
            await connectRuns(context, dir, command.optsWithGlobals());
        });
    connect
        .command('run')
        .description('Uma execução, com o que escreveria, os passos com erro e o stack')
        .argument('<execução>', 'id da execução')
        .argument('[pasta]', 'pasta do conector', '.')
        .action(async (runId: string, dir: string, _options: ConnectRunOptions, command: Command) => {
            await connectRun(context, runId, dir, command.optsWithGlobals());
        });
}

function addChangeCommands(connect: Command, context: CliContext): void {
    for (const kind of CHANGES) {
        connect
            .command(kind)
            .description(CHANGE_DESCRIPTIONS[kind])
            .argument('[pasta]', 'pasta do conector', '.')
            .option('--confirm <token>', 'aplica com o token da prévia, depois do sim da pessoa')
            .option('-y, --yes', 'aplica logo depois de mostrar a prévia')
            .action(async (dir: string, _options: ConnectRunOptions, command: Command) => {
                await connectChange(context, kind, dir, command.optsWithGlobals());
            });
    }
    connect
        .command('secrets')
        .description('Segredos do conector: o valor é digitado por uma pessoa e nunca volta')
        .command('set')
        .description('Preenche um segredo do manifesto')
        .argument('<nome>', 'nome do segredo, como no manifesto')
        .argument('[pasta]', 'pasta do conector', '.')
        .option('--stdin', 'lê o valor do stdin (para script)')
        .action(async (name: string, dir: string, _options: ConnectRunOptions, command: Command) => {
            await connectSecretSet(context, name, dir, command.optsWithGlobals());
        });
}

export function addConnectCommands(program: Command, context: CliContext): void {
    const connect: Command = program
        .command('connect')
        .description('Nexo Connect como código: o conector numa pasta do seu repositório')
        .option('--connector <id>', 'usa este conector no lugar do da pasta');
    connect
        .command('systems')
        .description('O catálogo de sistemas')
        .option('--category <categoria>', 'erp, crm, marketing, finance, ecommerce, helpdesk, database ou other')
        .action(async (_options: ConnectRunOptions, command: Command) => {
            await connectSystems(context, command.optsWithGlobals());
        });
    connect
        .command('list')
        .description('Os conectores da empresa')
        .action(async (_options: ConnectRunOptions, command: Command) => {
            await connectList(context, command.optsWithGlobals());
        });
    addFileCommands(connect, context);
    addSyncCommands(connect, context);
    addRunCommands(connect, context);
    addChangeCommands(connect, context);
}
