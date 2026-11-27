import type { Command } from 'commander';
import { webhookSecretSet, webhookShow } from './commands/connect-access.js';
import type { AccessOptions } from './commands/connect-access.js';
import { hostsApprove, hostsList } from './commands/connect-hosts.js';
import type { HostsApproveOptions } from './commands/connect-hosts.js';
import type { CliContext } from './context.js';

const FOLDER_HELP: string = 'pasta do conector';

function addHostsCommands(connect: Command, context: CliContext): void {
    const hosts: Command = connect
        .command('hosts')
        .description('Os hosts do conector: os aprovados e os que esperam o sim de uma pessoa')
        .argument('[pasta]', FOLDER_HELP, '.')
        .action(async (dir: string, _options: AccessOptions, command: Command) => {
            await hostsList(context, dir, command.optsWithGlobals());
        });
    hosts
        .command('approve')
        .description(
            'Pede a aprovação dos hosts: abre a tela do conector, onde a pessoa aprova com a sessão dela, e confere o resultado (até 10 minutos)'
        )
        .argument('[host...]', 'hosts a aprovar, e por último a pasta do conector (padrão: todos os que esperam, na pasta atual)')
        .option('--no-wait', 'só abre a tela, sem esperar a aprovação')
        .action(async (args: string[], _options: HostsApproveOptions, command: Command) => {
            await hostsApprove(context, args, command.optsWithGlobals());
        });
}

function addWebhookCommands(connect: Command, context: CliContext): void {
    const webhook: Command = connect
        .command('webhook')
        .description('O webhook do conector: a URL, como o outro sistema assina e se há segredo')
        .argument('[pasta]', FOLDER_HELP, '.')
        .action(async (dir: string, _options: AccessOptions, command: Command) => {
            await webhookShow(context, dir, command.optsWithGlobals());
        });
    webhook
        .command('secret')
        .description('O segredo com que o outro sistema assina o webhook')
        .command('set')
        .description('Define o segredo (o anterior deixa de valer na hora): digitado sem eco, por --stdin ou gerado aqui')
        .argument('[pasta]', FOLDER_HELP, '.')
        .option('--stdin', 'lê o valor do stdin (para script)')
        .option('--generate', 'gera 32 bytes em hexadecimal nesta máquina e mostra o valor uma vez')
        .action(async (dir: string, _options: AccessOptions, command: Command) => {
            await webhookSecretSet(context, dir, command.optsWithGlobals());
        });
}

export function addAccessCommands(connect: Command, context: CliContext): void {
    addHostsCommands(connect, context);
    addWebhookCommands(connect, context);
}
