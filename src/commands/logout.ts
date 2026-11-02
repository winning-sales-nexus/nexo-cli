import { revokeToken } from '../auth/oauth.js';
import type { StoredProfile } from '../config/credentials-store.js';
import { profileName } from '../config/session.js';
import { printJson, printLine, printNotice } from '../context.js';
import type { CliContext, GlobalOptions } from '../context.js';
import { CliError } from '../errors.js';

type Revocation = 'revoked' | 'failed' | 'not_applicable';

async function revoke(context: CliContext, stored: StoredProfile | null): Promise<Revocation> {
    if (stored?.kind !== 'oauth') {
        return 'not_applicable';
    }
    try {
        return (await revokeToken(context.fetchFn, stored.apiUrl, stored.refreshToken)) ? 'revoked' : 'failed';
    } catch (error: unknown) {
        if (error instanceof CliError) {
            return 'failed';
        }
        throw error;
    }
}

function notices(context: CliContext, stored: StoredProfile | null, revocation: Revocation): void {
    if (revocation === 'revoked') {
        printNotice(context, 'O acesso da CLI foi revogado no Nexo.');
    }
    if (revocation === 'failed') {
        printNotice(context, 'Não consegui revogar no Nexo; desconecte a "Nexo CLI" em Configurações › Integrações › Tokens de API e MCP.');
    }
    if (stored?.kind === 'pat') {
        printNotice(context, 'O token continua valendo até você revogá-lo no Nexo, em Configurações › Integrações › Tokens de API e MCP.');
    }
    if ((context.env.NEXO_TOKEN ?? '') !== '') {
        printNotice(context, 'NEXO_TOKEN ainda está definido no ambiente e continua sendo usado.');
    }
}

export async function logout(context: CliContext, options: GlobalOptions): Promise<void> {
    const profile: string = profileName(options.profile, context.env);
    const stored: StoredProfile | null = context.store.profile(profile);
    const revocation: Revocation = await revoke(context, stored);
    const removed: boolean = context.store.remove(profile);
    if (options.json === true) {
        printJson(context, { profile, removed, revocation, envTokenStillSet: (context.env.NEXO_TOKEN ?? '') !== '' });
        return;
    }
    printLine(context, removed ? `Perfil ${profile} removido desta máquina.` : `Nenhum perfil ${profile} salvo nesta máquina.`);
    notices(context, stored, revocation);
}
