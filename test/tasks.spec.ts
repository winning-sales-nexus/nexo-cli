import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { CredentialsStore } from '../src/config/credentials-store.js';
import type { CliContext } from '../src/context.js';
import type { FetchFunction } from '../src/http/nexo-client.js';
import { run } from '../src/run.js';

const API: string = 'https://mcp-nexo.winningsales.com.br';
const TASK_ID: string = '0192a8f4-5b1e-7d2a-8c3f-6e9d2a1b7c04';
const CONVERSATION: string = '0192a8f4-5b1e-7d2a-8c3f-6e9d2a1b7c99';

const RUNNING: Record<string, unknown> = {
    id: TASK_ID,
    kind: 'dashboard_build',
    status: 'running',
    parcial: false,
    conversationId: CONVERSATION,
    createdAt: '2026-11-07T14:30:00.000Z',
    finishedAt: null,
    costMicros: 1_250_000,
    canReview: false,
    resumo: null
};
const DONE: Record<string, unknown> = {
    ...RUNNING,
    id: '0192a8f4-5b1e-7d2a-8c3f-6e9d2a1b7c05',
    kind: 'contact_report',
    status: 'done',
    finishedAt: '2026-11-07T14:40:00.000Z',
    canReview: true,
    resumo: 'Montei o relatório da Ana.'
};
const CANCELLED: Record<string, unknown> = { ...RUNNING, status: 'cancelled', finishedAt: '2026-11-07T14:35:00.000Z' };

interface Route {
    readonly status?: number;
    readonly body: unknown;
}

interface Harness {
    readonly context: CliContext;
    readonly calls: string[];
    readonly out: () => string;
    readonly err: () => string;
}

function harness(routes: Readonly<Record<string, Route>>, tty: boolean = false): Harness {
    const calls: string[] = [];
    const stdout: PassThrough = new PassThrough();
    const stderr: PassThrough = new PassThrough();
    let out: string = '';
    let err: string = '';
    stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    stderr.on('data', (chunk: Buffer) => (err += chunk.toString()));
    const fetchFn: FetchFunction = (url: string, init: RequestInit) => {
        const key: string = `${init.method ?? 'GET'} ${url.replace(API, '')}`;
        calls.push(key);
        const route: Route = routes[key] ?? { status: 404, body: { title: 'Not Found', status: 404 } };
        return Promise.resolve(
            new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers: { 'content-type': 'application/json' } })
        );
    };
    const stdin: Readable & { isTTY?: boolean } = Readable.from(['']);
    stdin.isTTY = tty;
    const context: CliContext = {
        store: new CredentialsStore(mkdtempSync(join(tmpdir(), 'nexo-tasks-'))),
        env: { NEXO_TOKEN: `nexo_pat_${'d'.repeat(38)}` },
        stdin,
        stdout,
        stderr,
        fetchFn,
        openUrl: () => Promise.resolve(false)
    };
    return { context, calls, out: () => out, err: () => err };
}

const CANCEL_PATH: string = `/v1/copilot/tasks/${TASK_ID}/cancel`;
const GET_PATH: string = `/v1/copilot/tasks/${TASK_ID}`;

const NOT_CANCELLABLE: Route = {
    status: 409,
    body: {
        type: 'copilot.task_not_cancellable',
        title: 'CopilotTaskNotCancellableError',
        status: 409,
        detail: 'Esta tarefa já terminou; não dá mais para cancelar.',
        requestId: 'req-1'
    }
};
const NOT_FOUND: Route = {
    status: 404,
    body: {
        type: 'copilot.background_task_not_found',
        title: 'CopilotBackgroundTaskNotFoundError',
        status: 404,
        detail: 'Tarefa não encontrada, ou de outra pessoa.'
    }
};

describe('nexo tasks list', () => {
    it('lists the tasks in Portuguese, without the word CRM', async () => {
        const h: Harness = harness({ 'GET /v1/copilot/tasks': { body: [RUNNING, DONE] } });

        expect(await run(h.context, ['tasks', 'list'])).toBe(0);

        const lines: string[] = h.out().trimEnd().split('\n');
        expect(lines).toHaveLength(2);
        expect(lines[0]).toContain(TASK_ID);
        expect(lines[0]).toContain('rodando');
        expect(lines[0]).toContain('montar um painel');
        expect(lines[0]).toContain('07/11/2026 14:30');
        expect(lines[0]).toMatch(/R\$\s1,25/);
        expect(lines[1]).toContain('pronta');
        expect(lines[1]).toContain('relatório de um contato');
        expect(h.out()).not.toMatch(/crm/i);
    });

    it('prints the API list as it came with --json', async () => {
        const h: Harness = harness({ 'GET /v1/copilot/tasks': { body: [RUNNING, DONE] } });

        await run(h.context, ['tasks', 'list', '--json']);

        expect(JSON.parse(h.out())).toEqual([RUNNING, DONE]);
    });

    it('says there are none, and where tasks start', async () => {
        const h: Harness = harness({ 'GET /v1/copilot/tasks': { body: [] } });

        expect(await run(h.context, ['tasks', 'list'])).toBe(0);

        expect(h.out()).toBe('Nenhuma tarefa em segundo plano.\n');
        expect(h.err()).toContain('se começam no Copiloto, dentro do app');
    });

    it('does not break on an older API without the routes', async () => {
        const h: Harness = harness({});

        expect(await run(h.context, ['tasks', 'list'])).toBe(5);

        expect(h.err()).toContain('Esta versão do Nexo ainda não tem tarefas em segundo plano.');
        expect(h.err()).not.toContain('Erro inesperado');
    });
});

describe('nexo tasks get', () => {
    it('shows the state, the cost and the summary', async () => {
        const h: Harness = harness({ [`GET /v1/copilot/tasks/${String(DONE.id)}`]: { body: DONE } });

        expect(await run(h.context, ['tasks', 'get', String(DONE.id)])).toBe(0);

        expect(h.out()).toContain('relatório de um contato');
        expect(h.out()).toContain('Estado: pronta');
        expect(h.out()).toContain(`Conversa: ${CONVERSATION}`);
        expect(h.out()).toContain('Há uma mudança esperando a sua aprovação no app.');
        expect(h.out()).toContain('Resumo: Montei o relatório da Ana.');
    });

    it('prints the task as it came with --json', async () => {
        const h: Harness = harness({ [`GET ${GET_PATH}`]: { body: RUNNING } });

        await run(h.context, ['tasks', 'get', TASK_ID, '--json']);

        expect(JSON.parse(h.out())).toEqual(RUNNING);
    });

    it('writes the phrase and the code on stderr and exits 5 when the task does not exist', async () => {
        const h: Harness = harness({ [`GET ${GET_PATH}`]: NOT_FOUND });

        expect(await run(h.context, ['tasks', 'get', TASK_ID])).toBe(5);

        expect(h.err()).toBe('Erro: Tarefa não encontrada, ou de outra pessoa. (copilot.background_task_not_found)\n');
        expect(h.out()).toBe('');
    });
});

describe('nexo tasks cancel', () => {
    it('shows what will be cancelled and does not cancel without the yes', async () => {
        const h: Harness = harness({ [`GET ${GET_PATH}`]: { body: RUNNING }, [`POST ${CANCEL_PATH}`]: { body: CANCELLED } });

        expect(await run(h.context, ['tasks', 'cancel', TASK_ID])).toBe(0);

        expect(h.out()).toContain(`Cancelar a tarefa ${TASK_ID} (montar um painel, rodando)`);
        expect(h.err()).toContain('Depois do sim dela, rode de novo com --yes.');
        expect(h.calls).toEqual([`GET ${GET_PATH}`]);
    });

    it('cancels with --yes', async () => {
        const h: Harness = harness({ [`GET ${GET_PATH}`]: { body: RUNNING }, [`POST ${CANCEL_PATH}`]: { body: CANCELLED } });

        expect(await run(h.context, ['tasks', 'cancel', TASK_ID, '--yes'])).toBe(0);

        expect(h.calls).toEqual([`GET ${GET_PATH}`, `POST ${CANCEL_PATH}`]);
        expect(h.out()).toContain(`Tarefa ${TASK_ID} cancelada.`);
        expect(h.out()).toMatch(/R\$\s1,25/);
    });

    it('prints the cancelled task with --json', async () => {
        const h: Harness = harness({ [`GET ${GET_PATH}`]: { body: RUNNING }, [`POST ${CANCEL_PATH}`]: { body: CANCELLED } });

        await run(h.context, ['tasks', 'cancel', TASK_ID, '--yes', '--json']);

        expect(JSON.parse(h.out())).toEqual(CANCELLED);
    });

    it('refuses a finished task on stderr with the phrase and the code, exit 1', async () => {
        const h: Harness = harness({ [`GET ${GET_PATH}`]: { body: DONE }, [`POST ${CANCEL_PATH}`]: NOT_CANCELLABLE });

        expect(await run(h.context, ['tasks', 'cancel', TASK_ID])).toBe(1);

        expect(h.err()).toBe('Erro: Esta tarefa já terminou; não dá mais para cancelar. (copilot.task_not_cancellable) [pedido req-1]\n');
        expect(h.out()).toBe('');
    });

    it('keeps the problem JSON on stderr with --json', async () => {
        const h: Harness = harness({ [`GET ${GET_PATH}`]: { body: DONE }, [`POST ${CANCEL_PATH}`]: NOT_CANCELLABLE });

        expect(await run(h.context, ['tasks', 'cancel', TASK_ID, '--json'])).toBe(1);

        expect(JSON.parse(h.err())).toMatchObject({ type: 'copilot.task_not_cancellable', status: 409 });
    });
});

describe('tasks help and skill', () => {
    it('says tasks start in the app and has no command to start one', async () => {
        const h: Harness = harness({});

        await run(h.context, ['tasks', '--help']);

        expect(h.out().replace(/\s+/g, ' ')).toContain('Tarefas em segundo plano se começam no Copiloto, dentro do app');
        expect(h.out()).not.toMatch(/crm/i);
        expect(h.out()).toMatch(/\n {2}list\b/);
        expect(h.out()).toMatch(/\n {2}get\b/);
        expect(h.out()).toMatch(/\n {2}cancel\b/);
        expect(h.out()).not.toMatch(/\n {2}(start|create|run|new)\b/);
    });

    it('installs the line about the commands in the three targets', async () => {
        const directory: string = mkdtempSync(join(tmpdir(), 'nexo-tasks-skill-'));
        const h: Harness = harness({});

        expect(await run(h.context, ['skills', 'install', '--all', '--dir', directory])).toBe(0);

        for (const file of ['.claude/skills/nexo-api/SKILL.md', '.cursor/rules/nexo-api.mdc', '.nexo/skills/nexo-api.md']) {
            expect(readFileSync(join(directory, file), 'utf8')).toContain('nexo tasks cancel <id>');
        }
    });
});
