import { clientOf, printJson, printLine, sessionOf } from '../context.js';
import type { CliContext, GlobalOptions } from '../context.js';
import type { Session } from '../config/session.js';
import type { paths } from '../generated/openapi.js';
import type { ApiResponse } from '../http/nexo-client.js';

export type Me = paths['/v1/me']['get']['responses'][200]['content']['application/json'];

function profilesOf(me: Me): string {
    const names: readonly string[] = me.user.profiles.map((profile: { readonly name: string }) => profile.name);
    return names.length === 0 ? 'sem perfil' : `${names.length === 1 ? 'perfil' : 'perfis'}: ${names.join(', ')}`;
}

function isMe(value: unknown): value is Me {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const fields: Partial<Record<'user' | 'company' | 'credential', unknown>> = value;
    return typeof fields.user === 'object' && typeof fields.company === 'object' && typeof fields.credential === 'object';
}

export async function fetchMe(context: CliContext, session: Session): Promise<Me> {
    const response: ApiResponse = await clientOf(context, session).request({ method: 'GET', path: '/v1/me' });
    if (!isMe(response.body)) {
        throw new Error('Resposta inesperada de /v1/me.');
    }
    return response.body;
}

export function describeMe(me: Me, session: Session): readonly string[] {
    const expires: string = new Date(me.credential.expiresAt).toLocaleDateString('pt-BR', { timeZone: me.company.timezone });
    const source: string = session.source === 'env' ? 'NEXO_TOKEN' : `perfil ${session.profile}`;
    return [
        `${me.user.name} <${me.user.email}>, ${profilesOf(me)}`,
        `Empresa: ${me.company.name}`,
        `Credencial: ${me.credential.name} (${source}), vale até ${expires}`,
        `Escopos: ${me.credential.scopes.join(', ')}`,
        `API: ${session.apiUrl}`
    ];
}

export async function whoami(context: CliContext, options: GlobalOptions): Promise<void> {
    const session: Session = sessionOf(context, options);
    const me: Me = await fetchMe(context, session);
    if (options.json === true) {
        printJson(context, me);
        return;
    }
    for (const line of describeMe(me, session)) {
        printLine(context, line);
    }
}
