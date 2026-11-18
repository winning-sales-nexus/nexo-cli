import type { Command } from 'commander';
import { artifactsGet, artifactsList, dealsAnalysis } from './commands/artifacts.js';
import type { ArtifactOptions } from './commands/artifacts.js';
import type { CliContext } from './context.js';

export function addDealCommands(program: Command, context: CliContext): void {
    const deals: Command = program.command('deals').alias('negocios').description('Os negócios do Nexo: a análise do negócio');
    deals
        .command('analysis')
        .alias('analise')
        .description('Gera (ou atualiza) a análise de um negócio e mostra o link para abrir e como a IA terminou (aiState)')
        .argument('<negócio>', 'id do negócio')
        .option('--brief <texto>', 'o foco que você quer na análise, nas suas palavras (até 1.500 caracteres)')
        .action(async (dealId: string, _options: ArtifactOptions, command: Command) => {
            await dealsAnalysis(context, dealId, command.optsWithGlobals());
        });
}

export function addArtifactCommands(program: Command, context: CliContext): void {
    const artifacts: Command = program
        .command('artifacts')
        .alias('artefatos')
        .description('Os artefatos de um negócio, como a análise escrita (só leitura)');
    artifacts
        .command('list')
        .description('Os artefatos de um negócio que você lê, do mais recente para o mais antigo')
        .requiredOption('--deal <id>', 'o negócio')
        .option('--kind <tipo>', 'só os deste tipo, como analysis')
        .option('--page <n>', 'página da lista')
        .option('--page-size <n>', 'artefatos por página')
        .action(async (_options: ArtifactOptions, command: Command) => {
            await artifactsList(context, command.optsWithGlobals());
        });
    artifacts
        .command('get')
        .description('Um artefato com as versões; com --version, o conteúdo de uma versão (a análise vem como link para abrir)')
        .argument('<artefato>', 'id do artefato')
        .option('--version-number <n>', 'o número da versão a abrir')
        .action(async (artifactId: string, _options: ArtifactOptions, command: Command) => {
            await artifactsGet(context, artifactId, command.optsWithGlobals());
        });
}
