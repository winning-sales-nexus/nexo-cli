import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { CredentialsStore } from '../src/config/credentials-store.js';
import type { CliContext } from '../src/context.js';
import type { FetchFunction } from '../src/http/nexo-client.js';
import { run } from '../src/run.js';

const API: string = 'https://mcp-nexo.winningsales.com.br';

interface Call {
    readonly method: string;
    readonly path: string;
    readonly body: unknown;
}

interface Harness {
    readonly context: CliContext;
    readonly calls: Call[];
    readonly out: () => string;
    readonly err: () => string;
}

function harness(routes: Readonly<Record<string, { status?: number; body: unknown }>>): Harness {
    const calls: Call[] = [];
    const stdout: PassThrough = new PassThrough();
    const stderr: PassThrough = new PassThrough();
    let out: string = '';
    let err: string = '';
    stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    stderr.on('data', (chunk: Buffer) => (err += chunk.toString()));
    const fetchFn: FetchFunction = (url: string, init?: RequestInit) => {
        const path: string = url.replace(API, '');
        const method: string = init?.method ?? 'GET';
        calls.push({ method, path, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
        const route: { status?: number; body: unknown } = routes[`${method} ${path}`] ?? { status: 404, body: { title: 'Não encontrado' } };
        const status: number = route.status ?? 200;
        return Promise.resolve(
            new Response(status === 204 ? null : JSON.stringify(route.body), {
                status,
                headers: { 'content-type': 'application/json' }
            })
        );
    };
    const context: CliContext = {
        store: new CredentialsStore(mkdtempSync(join(tmpdir(), 'nexo-agents-'))),
        env: { NEXO_TOKEN: `nexo_pat_${'d'.repeat(38)}` },
        stdin: Readable.from(['']),
        stdout,
        stderr,
        fetchFn,
        openUrl: () => Promise.resolve(false)
    };
    return { context, calls, out: () => out, err: () => err };
}

const AGENT: Record<string, unknown> = {
    role: 'sdr',
    name: 'Nexo SDR',
    state: 'disabled',
    enabled: false,
    locked: false,
    lockReason: null,
    cases: ['after_hours'],
    bookMeeting: false,
    meetingMinutes: 30,
    meetingLeadMinutes: 120
};
const PREVIEW: Record<string, unknown> = {
    changes: ['Liga o Agente SDR; ele passa a atender fora do horário.'],
    confirmation: { token: 'tok-1' }
};
const SET_ROUTES: Record<string, { status?: number; body: unknown }> = {
    'GET /v1/admin/attendance-agents/sdr': { body: AGENT },
    'POST /v1/admin/attendance-agents/sdr/preview': { body: PREVIEW },
    'PUT /v1/admin/attendance-agents/sdr': { body: { ...AGENT, enabled: true, state: 'enabled' } }
};

describe('nexo agents', () => {
    it('lists both agents with the state', async () => {
        const h: Harness = harness({
            'GET /v1/admin/attendance-agents/sdr': { body: AGENT },
            'GET /v1/admin/attendance-agents/cs': {
                body: { ...AGENT, role: 'cs', name: 'Nexo CS', state: 'locked', lockReason: 'Nenhum perfil tem Atendimento CS' }
            }
        });

        expect(await run(h.context, ['agents'])).toBe(0);
        expect(h.out()).toContain('Nexo SDR  desligado');
        expect(h.out()).toContain('travado (Nenhum perfil tem Atendimento CS)');
    });

    it('shows one agent and refuses a role that does not exist', async () => {
        const h: Harness = harness({ 'GET /v1/admin/attendance-agents/sdr': { body: AGENT } });

        expect(await run(h.context, ['agents', 'show', 'sdr'])).toBe(0);
        expect(h.out()).toContain('duração: 30 min');
        expect(await run(h.context, ['agents', 'show', 'xx'])).not.toBe(0);
        expect(h.calls).toHaveLength(1);
    });

    it('with --yes previews then saves the whole config with the token', async () => {
        const h: Harness = harness(SET_ROUTES);

        const code: number = await run(h.context, ['agents', 'set', 'sdr', '--on', '--cases', 'after_hours,stalled_queue', '--yes']);

        expect(code).toBe(0);
        expect(h.calls.map((entry: Call) => entry.method)).toEqual(['GET', 'POST', 'PUT']);
        const sent: Record<string, unknown> = {
            name: 'Nexo SDR',
            enabled: true,
            cases: ['after_hours', 'stalled_queue'],
            bookMeeting: false,
            meetingMinutes: 30,
            meetingLeadMinutes: 120
        };
        expect(h.calls[1]?.body).toEqual(sent);
        expect(h.calls[2]?.body).toEqual({ ...sent, confirmationToken: 'tok-1' });
        expect(h.out()).toContain('Liga o Agente SDR');
    });

    it('without --yes and without a terminal shows the change and saves nothing', async () => {
        const h: Harness = harness(SET_ROUTES);

        expect(await run(h.context, ['agents', 'set', 'sdr', '--on'])).toBe(0);
        expect(h.calls.map((entry: Call) => entry.method)).toEqual(['GET', 'POST']);
        expect(h.out()).toContain('Liga o Agente SDR');
    });

    it('asks for something to change and shows the reason the API refuses with', async () => {
        const h: Harness = harness({
            'GET /v1/admin/attendance-agents/cs': { body: { ...AGENT, role: 'cs' } },
            'POST /v1/admin/attendance-agents/cs/preview': {
                status: 409,
                body: { title: 'Conflito', detail: 'Nenhum perfil tem Atendimento CS.' }
            }
        });

        expect(await run(h.context, ['agents', 'set', 'cs'])).not.toBe(0);
        expect(h.calls).toEqual([]);
        expect(await run(h.context, ['agents', 'set', 'cs', '--on', '--yes'])).not.toBe(0);
        expect(h.err()).toContain('Nenhum perfil tem Atendimento CS.');
        expect(h.calls.map((entry: Call) => entry.method)).toEqual(['GET', 'POST']);
    });
});

const HOURS: Record<string, unknown> = {
    source: 'company',
    days: [{ weekday: 1, ranges: [{ start: '09:00', end: '18:00' }] }]
};

describe('nexo agents hours', () => {
    it("reads your own and another seller's hours", async () => {
        const h: Harness = harness({
            'GET /v1/me/meeting-hours': { body: HOURS },
            'GET /v1/users/u-1/meeting-hours': { body: { ...HOURS, source: 'user' } }
        });

        expect(await run(h.context, ['agents', 'hours'])).toBe(0);
        expect(h.out()).toContain('o da empresa');
        expect(h.out()).toContain('seg: 09:00-18:00');
        expect(await run(h.context, ['agents', 'hours', 'u-1'])).toBe(0);
        expect(h.out()).toContain('o seu próprio');
    });

    it('changes your own with --day, after the preview and the yes', async () => {
        const h: Harness = harness({
            'POST /v1/me/meeting-hours/preview': { body: { before: HOURS, after: HOURS, ...PREVIEW } },
            'PUT /v1/me/meeting-hours': { body: { ...HOURS, source: 'user' } }
        });

        const code: number = await run(h.context, ['agents', 'hours', '--day', 'seg-ter=09:00-12:00,14:00-18:00', '--yes']);

        expect(code).toBe(0);
        const days: unknown = [
            {
                weekday: 1,
                ranges: [
                    { start: '09:00', end: '12:00' },
                    { start: '14:00', end: '18:00' }
                ]
            },
            {
                weekday: 2,
                ranges: [
                    { start: '09:00', end: '12:00' },
                    { start: '14:00', end: '18:00' }
                ]
            }
        ];
        expect(h.calls[0]?.body).toEqual({ days });
        expect(h.calls[1]?.body).toEqual({ days, confirmationToken: 'tok-1' });
    });

    it('goes back to the company hours with --company (days null)', async () => {
        const h: Harness = harness({
            'POST /v1/me/meeting-hours/preview': { body: { before: HOURS, after: HOURS, ...PREVIEW } },
            'PUT /v1/me/meeting-hours': { body: HOURS }
        });

        expect(await run(h.context, ['agents', 'hours', '--company', '--yes'])).toBe(0);
        expect(h.calls[0]?.body).toEqual({ days: null });
        expect(h.calls[1]?.body).toEqual({ days: null, confirmationToken: 'tok-1' });
    });

    it("refuses to change another seller's hours with a clear sentence, without calling the API", async () => {
        const h: Harness = harness({});

        expect(await run(h.context, ['agents', 'hours', 'u-1', '--company'])).not.toBe(0);
        expect(h.err()).toContain('Cada vendedor muda o próprio horário de reunião');
        expect(h.calls).toEqual([]);
    });
});
