import { Command, Option } from 'commander';
import { api } from './commands/api.js';
import { docsList, docsSearch, docsShow } from './commands/docs.js';
import type { DocsOptions } from './commands/docs.js';
import { mcpSetup } from './commands/mcp.js';
import { addConnectCommands } from './program-connect.js';
import { addAutomationCommands } from './program-automations.js';

import { addDashboardCommands } from './program-dashboards.js';
import type { McpOptions } from './commands/mcp.js';
import { skillsInstall, skillsList } from './commands/skills.js';
import type { SkillsOptions } from './commands/skills.js';
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

function addDocsCommands(program: Command, context: CliContext): void {
    const docs: Command = program.command('docs').description('A documentação do Nexo no terminal, embutida na CLI');
    docs.command('list')
        .description('Lista as páginas')
        .option('--online', 'lê a versão do ar, não a embutida')
        .action(async (_options: DocsOptions, command: Command) => {
            await docsList(context, command.optsWithGlobals());
        });
    docs.command('search')
        .description('Busca nas páginas')
        .argument('<termos...>', 'palavras a buscar')
        .option('--online', 'lê a versão do ar, não a embutida')
        .option('-n, --limit <n>', 'quantos resultados', '8')
        .action(async (terms: readonly string[], _options: DocsOptions, command: Command) => {
            await docsSearch(context, terms.join(' '), command.optsWithGlobals());
        });
    docs.command('show')
        .description('Mostra uma página inteira, em Markdown')
        .argument('<página>', 'nome da página (de docs list) ou parte do título')
        .option('--online', 'lê a versão do ar, não a embutida')
        .action(async (name: string, _options: DocsOptions, command: Command) => {
            await docsShow(context, name, command.optsWithGlobals());
        });
}

function addSkillsCommands(program: Command, context: CliContext): void {
    const skills: Command = program.command('skills').description('As regras do Nexo para a sua IA (Claude Code, Cursor, Codex)');
    skills
        .command('install')
        .description('Grava as skills do Nexo no projeto; sem opção, detecta o que o projeto usa')
        .option('--claude', 'em .claude/skills')
        .option('--cursor', 'em .cursor/rules')
        .option('--agents', 'em AGENTS.md e .nexo/skills (Codex e outros)')
        .option('--all', 'nos três')
        .option('-d, --dir <pasta>', 'pasta do projeto', '.')
        .action((_options: SkillsOptions, command: Command) => {
            skillsInstall(context, command.optsWithGlobals());
        });
    skills
        .command('list')
        .description('Lista as skills e onde estão instaladas no projeto')
        .option('-d, --dir <pasta>', 'pasta do projeto', '.')
        .action((_options: SkillsOptions, command: Command) => {
            skillsList(context, command.optsWithGlobals());
        });
}

function addMcpCommand(program: Command, context: CliContext): void {
    program
        .command('mcp')
        .description('Configura os servidores MCP do Nexo no cliente de IA do projeto')
        .command('setup')
        .description('Escreve a configuração do MCP do Nexo e do Nexo Connect, com o token lido de NEXO_TOKEN')
        .option('--claude', 'em .mcp.json (Claude Code)')
        .option('--cursor', 'em .cursor/mcp.json')
        .option('--codex', 'em .codex/config.toml')
        .addOption(new Option('--env <ambiente>', 'ambiente do Nexo (padrão: o do login)').choices(['prod', 'dev']))
        .option('-d, --dir <pasta>', 'pasta do projeto', '.')
        .action((_options: McpOptions, command: Command) => {
            mcpSetup(context, command.optsWithGlobals());
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
    addDocsCommands(program, context);
    addSkillsCommands(program, context);
    addMcpCommand(program, context);
    addConnectCommands(program, context);
    addAutomationCommands(program, context);

    addDashboardCommands(program, context);
    return program;
}
