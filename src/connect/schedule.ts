import type { CliContext } from '../context.js';
import type { Session } from '../config/session.js';
import { fetchMe } from '../commands/whoami.js';

/** A agenda como o `/v1` a devolve; uma resposta antiga não traz os campos. */
export interface ScheduleFields {
    readonly status?: string;
    readonly schedule?: string | null;
    readonly nextRunAt?: string | null;
}

/** O fuso da empresa (`/v1/me`); só se pergunta quando há uma próxima execução para mostrar. */
export async function companyTimeZone(context: CliContext, session: Session): Promise<string> {
    return (await fetchMe(context, session)).company.timezone;
}

export function formatNextRun(iso: string, timeZone: string): string {
    const parts: Record<string, string> = {};
    for (const part of new Intl.DateTimeFormat('pt-BR', {
        timeZone,
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(new Date(iso))) {
        parts[part.type] = part.value;
    }
    return `${parts.day ?? ''}/${parts.month ?? ''} ${parts.hour ?? ''}:${parts.minute ?? ''}`;
}

export function hasNextRun(rows: readonly ScheduleFields[]): boolean {
    return rows.some((row: ScheduleFields) => typeof row.nextRunAt === 'string');
}

/** A linha "Agenda" do `status`; nada quando a resposta é antiga e não traz a agenda. */
export function scheduleLine(fields: ScheduleFields, timeZone: string | null): string | null {
    if (fields.schedule === undefined) {
        return null;
    }
    if (fields.schedule === null) {
        return 'Agenda: sem agenda.';
    }
    if (typeof fields.nextRunAt === 'string') {
        return `Agenda: ${fields.schedule}. Próxima: ${formatNextRun(fields.nextRunAt, timeZone ?? 'UTC')}${timeZone === null ? ' UTC' : ''}.`;
    }
    if (fields.status === 'paused') {
        return `Agenda: ${fields.schedule} (pausado).`;
    }
    return `Agenda: ${fields.schedule} (não está ligado).`;
}
