import type { Command } from 'commander';
import { erpAction, erpList, erpQuery } from './commands/erp.js';
import type { ErpOptions } from './commands/erp.js';
import type { CliContext } from './context.js';

const TARGET: string = '<operação>';
const TARGET_HELP: string = 'id (<conector>:<chave>) ou chave da operação (veja `nexo erp list`)';
const ARGS: string = '--args <json|@arquivo>';
const ARGS_HELP: string = 'argumentos da operação: um objeto JSON, ou @arquivo';

export function addErpCommands(program: Command, context: CliContext): void {
    const erp: Command = program
        .command('erp')
        .description('Operações de ERP dos conectores: consultar e agir no outro sistema, como a pessoa que pede');
    erp.command('list')
        .description('As operações de ERP que você alcança: id, chave, tipo, conector e argumentos')
        .argument('[busca]', 'palavras da chave, do nome ou do conector')
        .action(async (search: string | undefined, _options: ErpOptions, command: Command) => {
            await erpList(context, search, command.optsWithGlobals());
        });
    erp.command('query')
        .description('Roda uma consulta e mostra o resultado (--json traz tudo)')
        .argument(TARGET, TARGET_HELP)
        .option(ARGS, ARGS_HELP)
        .action(async (target: string, _options: ErpOptions, command: Command) => {
            await erpQuery(context, target, command.optsWithGlobals());
        });
    erp.command('action')
        .description('Roda uma ação: mostra a prévia do que seria gravado no outro sistema e só aplica depois do sim')
        .argument(TARGET, TARGET_HELP)
        .option(ARGS, ARGS_HELP)
        .option('--confirm <token>', 'aplica com o token da prévia, depois do sim da pessoa')
        .action(async (target: string, _options: ErpOptions, command: Command) => {
            await erpAction(context, target, command.optsWithGlobals());
        });
}
