import type { Command } from 'commander';
import { connectInit, connectPull, connectPush, connectStatus } from './commands/connect-files.js';
import type { ConnectFileOptions } from './commands/connect-files.js';
import {
    connectChange,
    connectDelete,
    connectList,
    connectRename,
    connectRehearse,
    connectRun,
    connectRuns,
    connectSecretSet,
    connectSystems
} from './commands/connect-runs.js';
import type { ConnectRunOptions } from './commands/connect-runs.js';
import { connectBuild, connectBuildFix, connectBuildShow } from './commands/connect-build.js';
import type { BuildOptions } from './commands/connect-build.js';
import { connectExecute, connectUndo } from './commands/connect-execute.js';
import type { ExecuteOptions } from './commands/connect-execute.js';
import { connectDiff, connectRestore, connectVersions } from './commands/connect-versions.js';
import type { VersionOptions } from './commands/connect-versions.js';
import {
    quarantineDiscard,
    quarantineFix,
    quarantineList,
    quarantineReprocess,
    writeHost,
    writesConfirm,
    writesList
} from './commands/connect-retained.js';
import type { RetainedOptions } from './commands/connect-retained.js';
import { CHANGES } from './connect/changes.types.js';
import type { ChangeKind } from './connect/changes.types.js';
import type { CliContext } from './context.js';

const YES_HELP: string = 'aplica logo depois de mostrar a prévia';

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
        .option('--operation <chave>', 'ensaia esta operação do manifesto (com --args)')
        .option('--args <json|@arquivo>', 'argumentos da operação: um objeto JSON, ou @arquivo')
        .option('-q, --quiet', 'só o resumo, sem logs, resultado nem quarentena')
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
        .description(
            'Uma execução: o que escreveria, os passos com erro, o stack, os logs do script, o resultado e o que iria para a quarentena'
        )
        .argument('<execução>', 'id da execução')
        .argument('[pasta]', 'pasta do conector', '.')
        .option('-q, --quiet', 'só o resumo, sem logs, resultado nem quarentena')
        .action(async (runId: string, dir: string, _options: ConnectRunOptions, command: Command) => {
            await connectRun(context, runId, dir, command.optsWithGlobals());
        });
}

function addVersionCommands(connect: Command, context: CliContext): void {
    connect
        .command('versions')
        .description('As versões do conector: resumo, origem, quem escreveu, quando e se tem ensaio limpo')
        .argument('[pasta]', 'pasta do conector', '.')
        .action(async (dir: string, _options: VersionOptions, command: Command) => {
            await connectVersions(context, dir, command.optsWithGlobals());
        });
    connect
        .command('diff')
        .description('O que mudou no código e no manifesto entre duas versões (sem <para>, até a em edição)')
        .argument('<de>', 'versão mais antiga')
        .argument('[para]', 'versão mais nova (padrão: a em edição)')
        .argument('[pasta]', 'pasta do conector')
        .action(async (from: string, to: string | undefined, dir: string | undefined, _options: VersionOptions, command: Command) => {
            await connectDiff(context, from, to, dir, command.optsWithGlobals());
        });
    connect
        .command('restore')
        .description('Volta a uma versão: o Nexo guarda como versão nova em edição e a pasta é reescrita (mostra e pede o sim)')
        .argument('<versão>', 'número da versão (veja `nexo connect versions`)')
        .argument('[pasta]', 'pasta do conector', '.')
        .option('--confirm', 'aplica, depois do sim da pessoa')
        .option('-y, --yes', YES_HELP)
        .option('--force', 'descarta mudanças da pasta que não foram para o Nexo')
        .action(async (seq: string, dir: string, _options: VersionOptions, command: Command) => {
            await connectRestore(context, seq, dir, command.optsWithGlobals());
        });
}

function addExecuteCommands(connect: Command, context: CliContext): void {
    for (const kind of ['run-now', 'initial-load'] as const) {
        connect
            .command(kind)
            .description(
                kind === 'run-now'
                    ? 'Roda a versão publicada agora, ao vivo: grava no Nexo e o desfazer leva de volta (mostra e pede o sim)'
                    : 'Faz a carga inicial, ao vivo: lê a origem inteira e grava no Nexo (mostra e pede o sim)'
            )
            .argument('[pasta]', 'pasta do conector', '.')
            .option('--confirm', 'aplica, depois do sim da pessoa')
            .option('-y, --yes', YES_HELP)
            .option('--no-wait', 'só abre a execução, sem esperar')
            .option('-q, --quiet', 'só o resumo, sem logs, resultado nem quarentena')
            .action(async (dir: string, _options: ExecuteOptions, command: Command) => {
                await connectExecute(context, kind, dir, command.optsWithGlobals());
            });
    }
    connect
        .command('undo')
        .description('Desfaz uma execução: mostra a prévia do Nexo e aplica depois do sim')
        .argument('<execução>', 'id da execução (veja `nexo connect runs`)')
        .argument('[pasta]', 'pasta do conector', '.')
        .option('--confirm <token>', 'aplica com o token da prévia, depois do sim da pessoa')
        .option('-y, --yes', YES_HELP)
        .action(async (runId: string, dir: string, _options: ExecuteOptions, command: Command) => {
            await connectUndo(context, runId, dir, command.optsWithGlobals());
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

function addBuildCommands(connect: Command, context: CliContext): void {
    const build: Command = connect
        .command('build')
        .description(
            'Conversa com a IA do Connect: sem conector na pasta começa um, com conector manda a mensagem (gasta a franquia de IA da empresa)'
        )
        .argument('<pedido>', 'o que você quer, em português')
        .argument('[pasta]', 'pasta do conector')
        .option('--no-wait', 'só manda, sem esperar a resposta')
        .action(async (message: string, dir: string | undefined, _options: BuildOptions, command: Command) => {
            await connectBuild(context, message, dir, command.optsWithGlobals());
        });
    build
        .command('show')
        .description('A conversa com a IA do Connect: as mensagens e o que ela fez')
        .argument('[pasta]', 'pasta do conector', '.')
        .action(async (dir: string, _options: BuildOptions, command: Command) => {
            await connectBuildShow(context, dir, command.optsWithGlobals());
        });
    build
        .command('fix')
        .description('Pede à IA a correção de uma execução que falhou e espera a resposta (gasta a franquia de IA da empresa)')
        .argument('<execução>', 'id da execução (veja `nexo connect runs`)')
        .argument('[pasta]', 'pasta do conector', '.')
        .option('-m, --message <texto>', 'o que acrescentar ao pedido')
        .option('--no-wait', 'só manda, sem esperar a resposta')
        .action(async (runId: string, dir: string, _options: BuildOptions, command: Command) => {
            await connectBuildFix(context, runId, dir, command.optsWithGlobals());
        });
}

function collect(value: string, previous: readonly string[]): readonly string[] {
    return [...previous, value];
}

const TOKEN_OPTION: string = '--confirm <token>';
const TOKEN_HELP: string = 'aplica com o token da prévia, depois do sim da pessoa';

function addQuarantineCommands(connect: Command, context: CliContext): void {
    const quarantine: Command = connect
        .command('quarantine')
        .description('Os registros que o Nexo recusou: lista os abertos; corrigir, descartar e reprocessar pedem o sim')
        .argument('[pasta]', 'pasta do conector', '.')
        .action(async (dir: string, _options: RetainedOptions, command: Command) => {
            await quarantineList(context, dir, command.optsWithGlobals());
        });
    quarantine
        .command('fix')
        .description('Corrige os valores de um registro (mostra campo, valor de hoje e valor novo; pede o sim)')
        .argument('<registro>', 'id do registro (veja `nexo connect quarantine`)')
        .argument('[pasta]', 'pasta do conector', '.')
        .option('--set <campo=valor>', 'campo nativo, ou properties.<chave> para uma propriedade; repita para vários', collect, [])
        .option('--file <json>', 'o corpo do PATCH: { "values": {...}, "properties": {...} }')
        .option('--confirm', 'aplica, depois do sim da pessoa')
        .option('-y, --yes', YES_HELP)
        .action(async (item: string, dir: string, _options: RetainedOptions, command: Command) => {
            await quarantineFix(context, item, dir, command.optsWithGlobals());
        });
    quarantine
        .command('discard')
        .description('Descarta um registro: ele sai da quarentena sem ir para o Nexo (mostra o registro; pede o sim)')
        .argument('<registro>', 'id do registro (veja `nexo connect quarantine`)')
        .argument('[pasta]', 'pasta do conector', '.')
        .option('--confirm', 'aplica, depois do sim da pessoa')
        .option('-y, --yes', YES_HELP)
        .action(async (item: string, dir: string, _options: RetainedOptions, command: Command) => {
            await quarantineDiscard(context, item, dir, command.optsWithGlobals());
        });
    addReprocessCommand(quarantine, context);
}

function addReprocessCommand(quarantine: Command, context: CliContext): void {
    quarantine
        .command('reprocess')
        .description('Reprocessa os registros abertos (prévia do Nexo e o sim)')
        .argument('[pasta]', 'pasta do conector', '.')
        .option(TOKEN_OPTION, TOKEN_HELP)
        .option('-y, --yes', YES_HELP)
        .action(async (dir: string, _options: RetainedOptions, command: Command) => {
            await quarantineReprocess(context, dir, command.optsWithGlobals());
        });
}

function addWriteCommands(connect: Command, context: CliContext): void {
    const writes: Command = connect
        .command('writes')
        .description('Escritas no outro sistema: as retidas e os hosts confirmados')
        .argument('[pasta]', 'pasta do conector', '.')
        .action(async (dir: string, _options: RetainedOptions, command: Command) => {
            await writesList(context, dir, command.optsWithGlobals());
        });
    writes
        .command('confirm')
        .description('Confirma a escrita retida, que sai para o outro sistema e não se desfaz (prévia e sim)')
        .argument('<escrita>', 'id da escrita retida (veja `nexo connect writes`)')
        .argument('[pasta]', 'pasta do conector', '.')
        .option(TOKEN_OPTION, TOKEN_HELP)
        .option('-y, --yes', YES_HELP)
        .action(async (id: string, dir: string, _options: RetainedOptions, command: Command) => {
            await writesConfirm(context, id, dir, command.optsWithGlobals());
        });
    addWriteHostCommands(connect, context);
}

function addWriteHostCommands(connect: Command, context: CliContext): void {
    const hosts: Command = connect.command('write-hosts').description('A escrita do conector num host do outro sistema');
    for (const action of ['confirm', 'revoke'] as const) {
        hosts
            .command(action)
            .description(
                action === 'confirm'
                    ? 'Confirma a escrita num host do manifesto (prévia e sim)'
                    : 'Revoga a escrita num host confirmado (prévia e sim)'
            )
            .argument('<host>', 'host do outro sistema, como no manifesto')
            .argument('[pasta]', 'pasta do conector', '.')
            .option(TOKEN_OPTION, TOKEN_HELP)
            .option('-y, --yes', YES_HELP)
            .action(async (host: string, dir: string, _options: RetainedOptions, command: Command) => {
                await writeHost(context, action, host, dir, command.optsWithGlobals());
            });
    }
}

function addLifecycleCommands(connect: Command, context: CliContext): void {
    connect
        .command('rename')
        .description('Muda o nome do conector (e, se quiser, a descrição) e mostra o nome antigo e o novo')
        .argument('<nome>', 'nome novo')
        .argument('[pasta]', 'pasta do conector', '.')
        .option('--description <texto>', 'descrição nova (vazia apaga a descrição)')
        .action(async (name: string, dir: string, _options: ConnectRunOptions, command: Command) => {
            await connectRename(context, name, dir, command.optsWithGlobals());
        });
    connect
        .command('delete')
        .description(
            'Apaga o conector, sem volta (só pausado ou em rascunho): mostra a prévia e pede que você digite o nome; a pasta local fica no disco'
        )
        .argument('[pasta]', 'pasta do conector', '.')
        .option(TOKEN_OPTION, 'apaga com o token da prévia, depois do sim da pessoa (num script; -y não basta)')
        .action(async (dir: string, _options: ConnectRunOptions, command: Command) => {
            await connectDelete(context, dir, command.optsWithGlobals());
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
    addLifecycleCommands(connect, context);
    addFileCommands(connect, context);
    addSyncCommands(connect, context);
    addRunCommands(connect, context);
    addVersionCommands(connect, context);
    addExecuteCommands(connect, context);
    addChangeCommands(connect, context);
    addBuildCommands(connect, context);
    addQuarantineCommands(connect, context);
    addWriteCommands(connect, context);
}
