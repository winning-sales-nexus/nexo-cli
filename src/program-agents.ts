import type { Command } from 'commander';
import { agentsHours, agentsList, agentsSet, agentsShow } from './commands/agents.js';
import type { AgentsOptions } from './commands/agents.js';
import type { CliContext } from './context.js';

export function addAgentCommands(program: Command, context: CliContext): void {
    const agents: Command = program
        .command('agents')
        .alias('agentes')
        .description('Os Agentes de atendimento (SDR e CS): o estado, a configuração e o horário de reunião')
        .action(async (_options: AgentsOptions, command: Command) => {
            await agentsList(context, command.optsWithGlobals());
        });
    agents
        .command('show')
        .description('Mostra a configuração de um agente')
        .argument('<agente>', 'sdr ou cs')
        .action(async (role: string, _options: AgentsOptions, command: Command) => {
            await agentsShow(context, role, command.optsWithGlobals());
        });
    agents
        .command('set')
        .description('Muda um agente: mostra o que muda e só salva depois do sim (só administrador)')
        .argument('<agente>', 'sdr ou cs')
        .option('--on', 'liga o agente')
        .option('--off', 'desliga o agente')
        .option('--cases <casos>', 'after_hours, stalled_queue e covered_by_knowledge, separados por vírgula; none para nenhum')
        .option('--book-meeting', 'o Agente SDR marca reunião na agenda do vendedor')
        .option('--no-book-meeting', 'o Agente SDR deixa de marcar reunião')
        .option('--meeting-minutes <min>', 'duração da reunião: 30, 45 ou 60')
        .option('--meeting-lead <min>', 'antecedência mínima da reunião: 120, 240 ou 1440')
        .option('--name <nome>', 'nome do agente nas conversas (até 30 caracteres)')
        .option('-y, --yes', 'salva logo depois de mostrar o que muda')
        .action(async (role: string, _options: AgentsOptions, command: Command) => {
            await agentsSet(context, role, command.optsWithGlobals());
        });
    agents
        .command('hours')
        .description(
            'O horário de reunião: sem vendedor, lê e muda o seu; com o id de um vendedor, só lê (cada um muda o próprio). Mudar mostra o que muda e pede o sim'
        )
        .argument('[vendedor]', 'id do vendedor, só para ler')
        .option(
            '--day <dias=faixas>',
            'o horário próprio inteiro, como seg-sex=09:00-12:00,14:00-18:00 (repita por dia ou grupo de dias)',
            (value: string, previous: readonly string[] = []) => [...previous, value]
        )
        .option('--company', 'apaga o horário próprio e volta ao da empresa')
        .option('-y, --yes', 'salva logo depois de mostrar o que muda')
        .action(async (seller: string | undefined, _options: AgentsOptions, command: Command) => {
            await agentsHours(context, seller, command.optsWithGlobals());
        });
}
