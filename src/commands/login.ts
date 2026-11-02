import { DEFAULT_ENVIRONMENT, ENVIRONMENTS, TOKENS_PAGE, environmentNamed, normalizedApiUrl } from '../config/environments.js';
import type { NexoEnvironment } from '../config/environments.js';
import { profileName } from '../config/session.js';
import type { Session } from '../config/session.js';
import { printJson, printLine, printNotice } from '../context.js';
import type { CliContext, GlobalOptions } from '../context.js';
import { usageError } from '../errors.js';
import { readAll, readSecret } from '../input/read-input.js';
import { describeMe, fetchMe } from './whoami.js';
import type { Me } from './whoami.js';

export interface LoginOptions extends GlobalOptions {
    readonly withToken?: boolean;
    readonly env?: string;
    readonly apiUrl?: string;
}

const PERSONAL_TOKEN: RegExp = /^nexo_pat_[A-Za-z0-9]{38}$/;

function appUrlOf(apiUrl: string): string {
    const known: NexoEnvironment | undefined = Object.values(ENVIRONMENTS).find((environment) => environment.apiUrl === apiUrl);
    return (known ?? DEFAULT_ENVIRONMENT).appUrl;
}

function targetApiUrl(options: LoginOptions): string {
    if (options.apiUrl !== undefined) {
        return normalizedApiUrl(options.apiUrl);
    }
    return environmentNamed(options.env ?? 'prod').apiUrl;
}

async function tokenFrom(context: CliContext, options: LoginOptions, apiUrl: string): Promise<string> {
    if (options.withToken === true) {
        return (await readAll(context.stdin)).trim();
    }
    if (context.stdin.isTTY !== true) {
        throw usageError('Sem terminal para perguntar o token.', 'Use `nexo login --with-token < arquivo`, ou defina NEXO_TOKEN.');
    }
    printNotice(context, `Crie um token pessoal em ${appUrlOf(apiUrl)}${TOKENS_PAGE} e cole aqui.`);
    return (await readSecret(context.stdin, context.stderr, 'Token: ')).trim();
}

export async function login(context: CliContext, options: LoginOptions): Promise<void> {
    const apiUrl: string = targetApiUrl(options);
    const token: string = await tokenFrom(context, options, apiUrl);
    if (!PERSONAL_TOKEN.test(token)) {
        throw usageError(
            'Isso não parece um token pessoal do Nexo.',
            'O token começa com nexo_pat_ e aparece uma vez só, quando é criado.'
        );
    }
    const profile: string = profileName(options.profile, context.env);
    const session: Session = { apiUrl, token, source: 'profile', profile };
    const me: Me = await fetchMe(context, session);
    context.store.save(profile, { apiUrl, token, kind: 'pat', savedAt: new Date().toISOString() });
    if (options.json === true) {
        printJson(context, { profile, apiUrl, user: me.user, company: me.company });
        return;
    }
    printLine(context, `Pronto. Perfil ${profile} salvo em ${context.store.path}.`);
    for (const line of describeMe(me, session)) {
        printLine(context, line);
    }
}
