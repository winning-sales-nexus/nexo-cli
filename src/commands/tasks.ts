import { clientOf, printJson, printLine, printNotice, sessionOf } from '../context.js';
import type { CliContext, GlobalOptions } from '../context.js';
import { CliError } from '../errors.js';
import { confirmed } from '../input/confirm.js';
import { NexoApiError } from '../http/problem.js';
import type { ApiResponse, HttpMethod } from '../http/nexo-client.js';
import { brl } from './billing.js';

export interface TasksOptions extends GlobalOptions {
    readonly yes?: boolean;
}

type TaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

interface TaskView {
    readonly id: string;
    readonly kind: string;
    readonly status: TaskStatus;
    readonly parcial: boolean;
    readonly conversationId: string;
    readonly createdAt: string;
    readonly finishedAt: string | null;
    readonly costMicros: number;
    readonly canReview: boolean;
    readonly resumo: string | null;
}

const KIND_LABELS: Readonly<Record<string, string>> = {
    dashboard_build: 'montar um painel',
    contact_report: 'relatório de um contato'
};
const STATUS_LABELS: Readonly<Record<string, string>> = {
    queued: 'na fila',
    running: 'rodando',
    done: 'pronta',
    failed: 'falhou',
    cancelled: 'cancelada'
};
const NOT_FOUND: string = 'copilot.background_task_not_found';
const OLD_API: string = 'Esta versão do Nexo ainda não tem tarefas em segundo plano.';

function kindOf(task: TaskView): string {
    return KIND_LABELS[task.kind] ?? task.kind;
}

function statusOf(task: TaskView): string {
    return STATUS_LABELS[task.status] ?? task.status;
}

function when(value: string | null): string {
    if (value === null) {
        return '—';
    }
    const [date, time] = value.split('T');
    const [year, month, day] = (date ?? '').split('-');
    return `${day ?? ''}/${month ?? ''}/${year ?? ''} ${(time ?? '').slice(0, 5)}`.trim();
}

function spent(task: TaskView): string {
    return brl(task.costMicros / 10_000);
}

/** Traduz o erro da API para a frase mais o código, no stderr, mantendo o código de saída da CLI. */
function refused(error: unknown, json: boolean): unknown {
    if (!(error instanceof NexoApiError) || json) {
        return error;
    }
    const { problem } = error;
    if (problem.status === 404 && problem.type !== NOT_FOUND) {
        return new CliError(OLD_API, error.exitCode, 'Atualize o Nexo, ou confira o endereço da API do seu perfil.');
    }
    const phrase: string = problem.detail ?? problem.title;
    const code: string = problem.type === 'about:blank' ? '' : ` (${problem.type})`;
    const reference: string = problem.requestId === null ? '' : ` [pedido ${problem.requestId}]`;
    return new CliError(`${phrase}${code}${reference}`, error.exitCode, error.hint);
}

async function call(context: CliContext, options: TasksOptions, method: HttpMethod, path: string): Promise<unknown> {
    try {
        const response: ApiResponse = await clientOf(context, sessionOf(context, options)).request({ method, path });
        return response.body;
    } catch (error: unknown) {
        throw refused(error, options.json === true);
    }
}

function taskPath(id: string, suffix: string = ''): string {
    return `/v1/copilot/tasks/${encodeURIComponent(id)}${suffix}`;
}

function taskRow(task: TaskView): string {
    return `${task.id}  ${statusOf(task).padEnd(9)} ${kindOf(task).padEnd(24)} ${when(task.createdAt)}  ${spent(task)}`;
}

export async function tasksList(context: CliContext, options: TasksOptions): Promise<void> {
    const body: unknown = await call(context, options, 'GET', '/v1/copilot/tasks');
    const tasks: readonly TaskView[] = Array.isArray(body) ? (body as readonly TaskView[]) : [];
    if (options.json === true) {
        printJson(context, tasks);
        return;
    }
    if (tasks.length === 0) {
        printLine(context, 'Nenhuma tarefa em segundo plano.');
        printNotice(context, 'Tarefas em segundo plano se começam no Copiloto, dentro do app.');
        return;
    }
    tasks.forEach((task: TaskView) => {
        printLine(context, taskRow(task));
    });
}

function describeTask(task: TaskView): readonly string[] {
    const lines: string[] = [
        `Tarefa ${task.id}: ${kindOf(task)}`,
        `Estado: ${statusOf(task)}${task.parcial ? ' (parcial: parou no teto de IA e entregou só o que já estava pronto)' : ''}`,
        `Aberta em ${when(task.createdAt)}; terminou em ${when(task.finishedAt)}`,
        `Gasto de IA: ${spent(task)}`,
        `Conversa: ${task.conversationId} (o resultado fica lá, no app)`
    ];
    if (task.canReview) {
        lines.push('Há uma mudança esperando a sua aprovação no app.');
    }
    if (task.resumo !== null) {
        lines.push(`Resumo: ${task.resumo}`);
    }
    return lines;
}

export async function tasksGet(context: CliContext, id: string, options: TasksOptions): Promise<void> {
    const task: TaskView = (await call(context, options, 'GET', taskPath(id))) as TaskView;
    if (options.json === true) {
        printJson(context, task);
        return;
    }
    describeTask(task).forEach((line: string) => {
        printLine(context, line);
    });
}

export async function tasksCancel(context: CliContext, id: string, options: TasksOptions): Promise<void> {
    const task: TaskView = (await call(context, options, 'GET', taskPath(id))) as TaskView;
    if (task.status === 'queued' || task.status === 'running') {
        const show: (context: CliContext, text: string) => void = options.json === true ? printNotice : printLine;
        show(context, `Cancelar a tarefa ${task.id} (${kindOf(task)}, ${statusOf(task)}): ela para e não entrega resultado.`);
        show(context, `O gasto de IA até aqui (${spent(task)}) fica; nada muda nos dados do Nexo.`);
        if (!(await confirmed(context, options.yes))) {
            return;
        }
    }
    const cancelled: TaskView = (await call(context, options, 'POST', taskPath(id, '/cancel'))) as TaskView;
    if (options.json === true) {
        printJson(context, cancelled);
        return;
    }
    printLine(context, `Tarefa ${cancelled.id} cancelada. Gasto de IA: ${spent(cancelled)}.`);
}
