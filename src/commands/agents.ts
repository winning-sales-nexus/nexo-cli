import { clientOf, printJson, printLine, printNotice, sessionOf } from '../context.js';
import type { CliContext, GlobalOptions } from '../context.js';
import { usageError } from '../errors.js';
import type { ApiResponse, HttpMethod } from '../http/nexo-client.js';
import { confirmed } from '../input/confirm.js';

export interface AgentsOptions extends GlobalOptions {
    readonly on?: boolean;
    readonly off?: boolean;
    readonly cases?: string;
    readonly bookMeeting?: boolean;
    readonly meetingMinutes?: string;
    readonly meetingLead?: string;
    readonly name?: string;
    readonly day?: readonly string[];
    readonly company?: boolean;
    readonly yes?: boolean;
}

type Role = 'sdr' | 'cs';

interface AgentSettings {
    readonly name: string;
    readonly enabled: boolean;
    readonly cases: readonly string[];
    readonly bookMeeting: boolean;
    readonly meetingMinutes: number;
    readonly meetingLeadMinutes: number;
}

interface AgentView extends AgentSettings {
    readonly role: Role;
    readonly state: string;
    readonly locked: boolean;
    readonly lockReason: string | null;
}

interface Preview {
    readonly changes: readonly string[];
    readonly confirmation: { readonly token: string };
}

interface Range {
    readonly start: string;
    readonly end: string;
}

interface Day {
    readonly weekday: number;
    readonly ranges: readonly Range[];
}

interface HoursView {
    readonly source: 'user' | 'company';
    readonly days: readonly Day[];
}

interface HoursPreview extends Preview {
    readonly before: HoursView;
    readonly after: HoursView;
}

const ROLES: readonly Role[] = ['sdr', 'cs'];
const CASES: ReadonlySet<string> = new Set(['after_hours', 'stalled_queue', 'covered_by_knowledge']);
const WEEKDAYS: readonly string[] = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'];
const STATES: Readonly<Record<string, string>> = { enabled: 'ligado', disabled: 'desligado', locked: 'travado' };

async function call(context: CliContext, options: GlobalOptions, method: HttpMethod, path: string, body?: unknown): Promise<unknown> {
    const response: ApiResponse = await clientOf(context, sessionOf(context, options)).request({
        method,
        path,
        ...(body === undefined ? {} : { body })
    });
    return response.body;
}

function roleOf(raw: string): Role {
    const role: Role | undefined = ROLES.find((entry: Role): boolean => entry === raw);
    if (role === undefined) {
        throw usageError(`O agente "${raw}" não existe: use sdr ou cs.`);
    }
    return role;
}

function agentLine(agent: AgentView): string {
    const state: string = STATES[agent.state] ?? agent.state;
    const lock: string = agent.lockReason === null ? '' : ` (${agent.lockReason})`;
    return `${agent.role.padEnd(4)} ${agent.name}  ${state}${lock}`;
}

function showAgent(context: CliContext, agent: AgentView): void {
    printLine(context, agentLine(agent));
    printLine(context, `  casos: ${agent.cases.length === 0 ? 'nenhum' : agent.cases.join(', ')}`);
    if (agent.role === 'sdr') {
        printLine(context, `  marca reunião: ${agent.bookMeeting ? 'sim' : 'não'}`);
        printLine(context, `  duração: ${String(agent.meetingMinutes)} min; antecedência mínima: ${String(agent.meetingLeadMinutes)} min`);
    }
}

export async function agentsList(context: CliContext, options: GlobalOptions): Promise<void> {
    const agents: AgentView[] = [];
    for (const role of ROLES) {
        agents.push((await call(context, options, 'GET', `/v1/admin/attendance-agents/${role}`)) as AgentView);
    }
    if (options.json === true) {
        printJson(context, agents);
        return;
    }
    agents.forEach((agent: AgentView) => {
        printLine(context, agentLine(agent));
    });
}

export async function agentsShow(context: CliContext, rawRole: string, options: GlobalOptions): Promise<void> {
    const agent: AgentView = (await call(context, options, 'GET', `/v1/admin/attendance-agents/${roleOf(rawRole)}`)) as AgentView;
    if (options.json === true) {
        printJson(context, agent);
        return;
    }
    showAgent(context, agent);
}

function casesOf(raw: string): readonly string[] {
    if (raw.trim() === 'none') {
        return [];
    }
    const cases: string[] = raw
        .split(',')
        .map((entry: string): string => entry.trim())
        .filter((entry: string): boolean => entry !== '');
    const unknown: string | undefined = cases.find((entry: string): boolean => !CASES.has(entry));
    if (unknown !== undefined || cases.length === 0) {
        throw usageError(`Caso "${unknown ?? raw}" não existe: use ${[...CASES].join(', ')} (separados por vírgula), ou none.`);
    }
    return cases;
}

function numberOf(raw: string, flag: string): number {
    const value: number = Number(raw);
    if (raw.trim() === '' || !Number.isInteger(value)) {
        throw usageError(`${flag} pede um número de minutos (recebi "${raw}").`);
    }
    return value;
}

/** Every contradiction and malformed value is refused here, before any call to the API. */
function overridesOf(options: AgentsOptions): Partial<AgentSettings> {
    if (options.on === true && options.off === true) {
        throw usageError('Escolha --on ou --off, não os dois.');
    }
    return {
        ...(options.name === undefined ? {} : { name: options.name }),
        ...(options.on === true || options.off === true ? { enabled: options.on === true } : {}),
        ...(options.cases === undefined ? {} : { cases: casesOf(options.cases) }),
        ...(options.bookMeeting === undefined ? {} : { bookMeeting: options.bookMeeting }),
        ...(options.meetingMinutes === undefined ? {} : { meetingMinutes: numberOf(options.meetingMinutes, '--meeting-minutes') }),
        ...(options.meetingLead === undefined ? {} : { meetingLeadMinutes: numberOf(options.meetingLead, '--meeting-lead') })
    };
}

function noChangeFlags(options: AgentsOptions): boolean {
    return [options.on, options.off, options.cases, options.bookMeeting, options.meetingMinutes, options.meetingLead, options.name].every(
        (value: unknown): boolean => value === undefined
    );
}

/** Shows what changes and asks for the yes; returns the token to save, or null when nothing is to be saved. */
async function decide(context: CliContext, preview: Preview, options: GlobalOptions & { readonly yes?: boolean }): Promise<string | null> {
    if (preview.changes.length === 0) {
        if (options.json !== true) {
            printLine(context, 'Já está assim; nada a mudar.');
        }
        return null;
    }
    if (options.json !== true) {
        printLine(context, 'O que muda:');
        preview.changes.forEach((change: string) => {
            printLine(context, `  - ${change}`);
        });
    }
    if (options.json === true && options.yes !== true) {
        return null;
    }
    if (!(await confirmed(context, options.yes, 'Salvar?'))) {
        printNotice(context, 'Nada foi salvo.');
        return null;
    }
    return preview.confirmation.token;
}

/** With --json the stdout is one JSON: the changes, whether it saved, and the saved result. */
function printOutcome(context: CliContext, preview: Preview, saved: unknown): void {
    printJson(context, { changes: preview.changes, saved: saved !== null, ...(saved === null ? {} : { result: saved }) });
}

export async function agentsSet(context: CliContext, rawRole: string, options: AgentsOptions): Promise<void> {
    const role: Role = roleOf(rawRole);
    if (noChangeFlags(options)) {
        throw usageError(
            'Diga o que mudar: --on, --off, --cases, --book-meeting, --no-book-meeting, --meeting-minutes, --meeting-lead ou --name.'
        );
    }
    const overrides: Partial<AgentSettings> = overridesOf(options);
    const path: string = `/v1/admin/attendance-agents/${role}`;
    const body: AgentSettings = { ...pickSettings((await call(context, options, 'GET', path)) as AgentView), ...overrides };
    const preview: Preview = (await call(context, options, 'POST', `${path}/preview`, body)) as Preview;
    const token: string | null = await decide(context, preview, options);
    const saved: AgentView | null =
        token === null ? null : ((await call(context, options, 'PUT', path, { ...body, confirmationToken: token })) as AgentView);
    if (options.json === true) {
        printOutcome(context, preview, saved);
        return;
    }
    if (saved !== null) {
        printLine(context, 'Salvo.');
        showAgent(context, saved);
    }
}

function pickSettings(view: AgentView): AgentSettings {
    return {
        name: view.name,
        enabled: view.enabled,
        cases: view.cases,
        bookMeeting: view.bookMeeting,
        meetingMinutes: view.meetingMinutes,
        meetingLeadMinutes: view.meetingLeadMinutes
    };
}

function parseClock(raw: string, day: string): string {
    if (!/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/u.test(raw)) {
        throw usageError(`Horário "${raw}" em "${day}" não vale: use HH:mm, como 09:00.`);
    }
    return raw;
}

function dayName(raw: string): string {
    return raw.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}

function weekdaysOf(raw: string, entry: string): readonly number[] {
    const names: string[] = raw.split('-').map(dayName);
    const start: number = WEEKDAYS.indexOf(names[0] ?? '');
    const end: number = names.length === 1 ? start : WEEKDAYS.indexOf(names[1] ?? '');
    if (names.length > 2 || start < 0 || end < start) {
        throw usageError(`Dia "${raw}" em "${entry}" não vale: use ${WEEKDAYS.join(', ')} ou uma sequência como seg-sex.`);
    }
    return Array.from({ length: end - start + 1 }, (_: unknown, index: number): number => start + index + 1);
}

function rangeOf(raw: string, entry: string): Range {
    const clocks: string[] = raw.split('-').map((clock: string): string => clock.trim());
    if (clocks.length !== 2) {
        throw usageError(`Faixa "${raw}" em "${entry}" não vale: use HH:mm-HH:mm, como 09:00-12:00.`);
    }
    return { start: parseClock(clocks[0] ?? '', entry), end: parseClock(clocks[1] ?? '', entry) };
}

function daysOf(entries: readonly string[]): readonly Day[] {
    const days: Map<number, Range[]> = new Map();
    for (const entry of entries) {
        const parts: string[] = entry.split('=');
        if (parts.length !== 2) {
            throw usageError(`"${entry}" não vale: use --day seg-sex=09:00-12:00,14:00-18:00.`);
        }
        const ranges: Range[] = (parts[1] ?? '').split(',').map((range: string): Range => rangeOf(range, entry));
        weekdaysOf(parts[0] ?? '', entry).forEach((weekday: number) => {
            days.set(weekday, [...(days.get(weekday) ?? []), ...ranges]);
        });
    }
    return [...days.entries()].sort(([a], [b]) => a - b).map(([weekday, ranges]): Day => ({ weekday, ranges }));
}

function hoursText(view: HoursView, seller?: string): string[] {
    const lines: string[] = view.days.map(
        (day: Day): string =>
            `  ${WEEKDAYS[day.weekday - 1] ?? String(day.weekday)}: ${day.ranges.map((range: Range): string => `${range.start}-${range.end}`).join(', ')}`
    );
    const whose: string = seller === undefined ? 'o seu próprio' : 'o próprio dele';
    const owner: string = seller === undefined ? '' : ` do vendedor ${seller}`;
    return [`Horário de reunião${owner} (${view.source === 'user' ? whose : 'o da empresa'}):`, ...lines];
}

async function showHours(context: CliContext, seller: string | undefined, options: AgentsOptions): Promise<void> {
    const path: string = seller === undefined ? '/v1/me/meeting-hours' : `/v1/users/${encodeURIComponent(seller)}/meeting-hours`;
    const view: HoursView = (await call(context, options, 'GET', path)) as HoursView;
    if (options.json === true) {
        printJson(context, view);
        return;
    }
    hoursText(view, seller).forEach((line: string) => {
        printLine(context, line);
    });
}

async function changeHours(context: CliContext, options: AgentsOptions): Promise<void> {
    const body: { readonly days: readonly Day[] | null } = { days: options.company === true ? null : daysOf(options.day ?? []) };
    const preview: HoursPreview = (await call(context, options, 'POST', '/v1/me/meeting-hours/preview', body)) as HoursPreview;
    const token: string | null = await decide(context, preview, options);
    const saved: HoursView | null =
        token === null
            ? null
            : ((await call(context, options, 'PUT', '/v1/me/meeting-hours', { ...body, confirmationToken: token })) as HoursView);
    if (options.json === true) {
        printOutcome(context, preview, saved);
        return;
    }
    if (saved !== null) {
        printLine(context, 'Salvo.');
        hoursText(saved).forEach((line: string) => {
            printLine(context, line);
        });
    }
}

function checkHoursFlags(seller: string | undefined, options: AgentsOptions): void {
    if (seller !== undefined) {
        throw usageError(
            'Cada vendedor muda o próprio horário de reunião; o horário de outra pessoa só se lê.',
            'Peça a ela para rodar `nexo agents hours --day ...` com o login dela.'
        );
    }
    if (options.day !== undefined && options.company === true) {
        throw usageError('Escolha --day (horário próprio) ou --company (volta ao da empresa), não os dois.');
    }
}

export async function agentsHours(context: CliContext, seller: string | undefined, options: AgentsOptions): Promise<void> {
    if (options.day === undefined && options.company !== true) {
        await showHours(context, seller, options);
        return;
    }
    checkHoursFlags(seller, options);
    await changeHours(context, options);
}
