import type { Command } from 'commander';
import {
    emailFiles,
    emailRenew,
    emailShow,
    oauthAuthorize,
    oauthClientRemove,
    oauthClientSet,
    oauthShow,
    sftpAccept,
    sftpKeys,
    webhookSecretSet,
    webhookShow
} from './commands/connect-access.js';
import type { AccessOptions } from './commands/connect-access.js';
import { hostsApprove, hostsList } from './commands/connect-hosts.js';
import type { HostsApproveOptions } from './commands/connect-hosts.js';
import type { CliContext } from './context.js';

const FOLDER_HELP: string = 'pasta do conector';
const CONFIRM_HELP: string = 'aplica, depois do sim da pessoa';
const YES_HELP: string = 'aplica logo depois de mostrar a prévia';

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

function addOAuthClientCommands(oauth: Command, context: CliContext): void {
    const client: Command = oauth.command('client').description('O app OAuth da própria empresa, no lugar do app do Nexo');
    client
        .command('set')
        .description('Usa o app da empresa: o client secret é digitado sem eco ou vem por --stdin (as autorizações caem; pede o sim)')
        .argument('[pasta]', FOLDER_HELP, '.')
        .requiredOption('--client-id <id>', 'o client id do app da empresa')
        .option('--stdin', 'lê o client secret do stdin (para script)')
        .option('--confirm', CONFIRM_HELP)
        .option('-y, --yes', YES_HELP)
        .action(async (dir: string, _options: AccessOptions, command: Command) => {
            await oauthClientSet(context, dir, command.optsWithGlobals());
        });
    client
        .command('remove')
        .description('Volta ao app do Nexo (as autorizações caem; pede o sim)')
        .argument('[pasta]', FOLDER_HELP, '.')
        .option('--confirm', CONFIRM_HELP)
        .option('-y, --yes', YES_HELP)
        .action(async (dir: string, _options: AccessOptions, command: Command) => {
            await oauthClientRemove(context, dir, command.optsWithGlobals());
        });
}

function addOAuthCommands(connect: Command, context: CliContext): void {
    const oauth: Command = connect
        .command('oauth')
        .description('A autorização OAuth do conector: o app, o estado e até quando o token vale')
        .argument('[pasta]', FOLDER_HELP, '.')
        .action(async (dir: string, _options: AccessOptions, command: Command) => {
            await oauthShow(context, dir, command.optsWithGlobals());
        });
    oauth
        .command('authorize')
        .description('Autoriza o Nexo no outro sistema: abre a página dele e espera a volta (até 10 minutos)')
        .argument('[pasta]', FOLDER_HELP, '.')
        .option('--no-wait', 'só abre a página, sem esperar')
        .action(async (dir: string, _options: AccessOptions, command: Command) => {
            await oauthAuthorize(context, dir, command.optsWithGlobals());
        });
    addOAuthClientCommands(oauth, context);
}

function addSftpCommands(connect: Command, context: CliContext): void {
    const sftp: Command = connect.command('sftp').description('As chaves dos servidores SFTP do conector');
    sftp.command('keys')
        .description('A chave guardada de cada servidor, com a impressão digital')
        .argument('[pasta]', FOLDER_HELP, '.')
        .action(async (dir: string, _options: AccessOptions, command: Command) => {
            await sftpKeys(context, dir, command.optsWithGlobals());
        });
    sftp.command('accept')
        .description(
            'Aceita a chave nova de um servidor: apaga a guardada e a próxima conexão guarda a nova (mostra a impressão digital; pede o sim)'
        )
        .argument('<host>', 'o servidor SFTP')
        .argument('[pasta]', FOLDER_HELP, '.')
        .option('--port <porta>', 'a porta do servidor', '22')
        .option('--confirm', CONFIRM_HELP)
        .option('-y, --yes', YES_HELP)
        .action(async (host: string, dir: string, _options: AccessOptions, command: Command) => {
            await sftpAccept(context, host, dir, command.optsWithGlobals());
        });
}

function addEmailCommands(connect: Command, context: CliContext): void {
    const email: Command = connect
        .command('email')
        .description('O endereço de e-mail do conector e quem pode mandar para ele')
        .argument('[pasta]', FOLDER_HELP, '.')
        .action(async (dir: string, _options: AccessOptions, command: Command) => {
            await emailShow(context, dir, command.optsWithGlobals());
        });
    email
        .command('renew')
        .description('Gera o endereço novo: o anterior para de valer (pede o sim)')
        .argument('[pasta]', FOLDER_HELP, '.')
        .option('--confirm', CONFIRM_HELP)
        .option('-y, --yes', YES_HELP)
        .action(async (dir: string, _options: AccessOptions, command: Command) => {
            await emailRenew(context, dir, command.optsWithGlobals());
        });
    email
        .command('files')
        .description('Os arquivos que chegaram nos últimos 30 dias e os deixados de fora, com o motivo')
        .argument('[pasta]', FOLDER_HELP, '.')
        .action(async (dir: string, _options: AccessOptions, command: Command) => {
            await emailFiles(context, dir, command.optsWithGlobals());
        });
}

export function addAccessCommands(connect: Command, context: CliContext): void {
    addHostsCommands(connect, context);
    addWebhookCommands(connect, context);
    addOAuthCommands(connect, context);
    addSftpCommands(connect, context);
    addEmailCommands(connect, context);
}
