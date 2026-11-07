import type { Command } from 'commander';
import { tasksCancel, tasksGet, tasksList } from './commands/tasks.js';
import type { TasksOptions } from './commands/tasks.js';
import type { CliContext } from './context.js';

export function addTaskCommands(program: Command, context: CliContext): void {
    const tasks: Command = program
        .command('tasks')
        .alias('tarefas')
        .description(
            'Tarefas em segundo plano se começam no Copiloto, dentro do app; aqui você vê e cancela (conversations:read e conversations:write)'
        );
    tasks
        .command('list')
        .description('Suas tarefas abertas e as dos últimos 7 dias, da mais nova para a mais antiga')
        .action(async (_options: TasksOptions, command: Command) => {
            await tasksList(context, command.optsWithGlobals());
        });
    tasks
        .command('get')
        .description('O estado de uma tarefa, com o resumo do que ela entregou')
        .argument('<id>', 'id da tarefa (veja `nexo tasks list`)')
        .action(async (id: string, _options: TasksOptions, command: Command) => {
            await tasksGet(context, id, command.optsWithGlobals());
        });
    tasks
        .command('cancel')
        .description('Cancela uma tarefa aberta: mostra o que será cancelado e pede o sim')
        .argument('<id>', 'id da tarefa (veja `nexo tasks list`)')
        .option('-y, --yes', 'cancela depois de mostrar, sem perguntar (só depois do sim da pessoa)')
        .action(async (id: string, _options: TasksOptions, command: Command) => {
            await tasksCancel(context, id, command.optsWithGlobals());
        });
}
