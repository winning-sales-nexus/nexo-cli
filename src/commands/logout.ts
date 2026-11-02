import { profileName } from '../config/session.js';
import { printJson, printLine, printNotice } from '../context.js';
import type { CliContext, GlobalOptions } from '../context.js';

export function logout(context: CliContext, options: GlobalOptions): void {
    const profile: string = profileName(options.profile, context.env);
    const removed: boolean = context.store.remove(profile);
    const envToken: boolean = (context.env.NEXO_TOKEN ?? '') !== '';
    if (options.json === true) {
        printJson(context, { profile, removed, envTokenStillSet: envToken });
        return;
    }
    printLine(context, removed ? `Perfil ${profile} removido desta máquina.` : `Nenhum perfil ${profile} salvo nesta máquina.`);
    printNotice(context, 'O token continua valendo até você revogá-lo no Nexo, em Configurações › Integrações › Tokens de API e MCP.');
    if (envToken) {
        printNotice(context, 'NEXO_TOKEN ainda está definido no ambiente e continua sendo usado.');
    }
}
