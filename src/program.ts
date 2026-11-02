import { Command, Option } from 'commander';
import { api } from './commands/api.js';
import type { ApiOptions } from './commands/api.js';
import { login } from './commands/login.js';
import type { LoginOptions } from './commands/login.js';
import { logout } from './commands/logout.js';
import { whoami } from './commands/whoami.js';
import type { CliContext, GlobalOptions } from './context.js';
import { CLI_VERSION } from './version.js';

function collect(value: string, previous: readonly string[]): readonly string[] {
    return [...previous, value];
}

function globalsOf(command: Command): GlobalOptions {
    return command.optsWithGlobals();
}

function addAuthCommands(program: Command, context: CliContext): void {
    program
        .command('login')
        .description('Entra no Nexo nesta máquina: pelo navegador, ou com um token pessoal')
        .option('--token', 'cola um token pessoal, no lugar do navegador')
        .option('--with-token', 'lê o token pessoal do stdin, sem perguntar')
        .option('--scopes <escopos>', 'escopos pedidos no navegador, separados por vírgula (padrão: os do Nexo)')
        .option('--no-browser', 'só mostra o endereço, sem abrir o navegador')
        .addOption(new Option('--env <ambiente>', 'ambiente do Nexo').choices(['prod', 'dev']).default('prod'))
        .option('--api-url <url>', 'endereço da API, no lugar do ambiente')
        .action(async (_options: LoginOptions, command: Command) => {
            await login(context, command.optsWithGlobals());
        });
    program
        .command('logout')
        .description('Sai do Nexo nesta máquina; o login pelo navegador é revogado no servidor')
        .action(async (_options: GlobalOptions, command: Command) => {
            await logout(context, globalsOf(command));
        });
    program
        .command('whoami')
        .description('Mostra quem está conectado, em qual empresa e com quais escopos')
        .action(async (_options: GlobalOptions, command: Command) => {
            await whoami(context, globalsOf(command));
        });
}

function addApiCommand(program: Command, context: CliContext): void {
    program
        .command('api')
        .description('Chama qualquer rota do /v1 e imprime a resposta em JSON')
        .argument('<caminho>', 'rota do /v1, como /v1/deals ou só deals')
        .option('-X, --method <método>', 'GET, POST, PUT, PATCH ou DELETE')
        .option('-f, --raw-field <chave=valor>', 'campo de texto (repita para mais de um)', collect, [])
        .option('-F, --field <chave=valor>', 'campo com tipo: número, true, false, null ou JSON', collect, [])
        .option('--input <arquivo>', 'corpo JSON de um arquivo, ou - para o stdin')
        .action(async (path: string, _options: ApiOptions, command: Command) => {
            await api(context, path, command.optsWithGlobals());
        });
}

export function buildProgram(context: CliContext): Command {
    const program: Command = new Command('nexo')
        .description('CLI do Nexo: a API, o Connect, os dashboards e os fluxos no terminal')
        .version(CLI_VERSION, '-v, --version', 'mostra a versão')
        .helpOption('-h, --help', 'mostra a ajuda')
        .helpCommand('help [comando]', 'mostra a ajuda de um comando')
        .option('-p, --profile <perfil>', 'perfil salvo a usar (padrão: default, ou NEXO_PROFILE)')
        .option('--json', 'saída em JSON, para script')
        .showHelpAfterError()
        .configureOutput({
            writeOut: (text: string) => context.stdout.write(text),
            writeErr: (text: string) => context.stderr.write(text)
        });
    addAuthCommands(program, context);
    addApiCommand(program, context);
    return program;
}
