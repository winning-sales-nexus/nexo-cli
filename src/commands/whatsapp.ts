import { clientOf, printJson, printLine, sessionOf } from '../context.js';
import type { CliContext, GlobalOptions } from '../context.js';
import type { ApiResponse } from '../http/nexo-client.js';

interface WhatsAppNumber {
    readonly id: string;
    readonly displayPhoneNumber: string | null;
    readonly verifiedName: string | null;
    readonly provider: string;
    readonly official: boolean;
    readonly ownerName: string | null;
    readonly companyNumber: boolean;
    readonly status: string;
    readonly cause: { readonly problem: string; readonly action: string } | null;
    readonly canSendTemplates: boolean;
}

interface WhatsAppNumberList {
    readonly items: readonly WhatsAppNumber[];
}

function describe(number: WhatsAppNumber): string {
    const phone: string = number.displayPhoneNumber ?? number.id;
    const kind: string = number.official ? 'oficial da Meta' : `${number.provider}, só leitura`;
    const owner: string = number.companyNumber || number.ownerName === null ? 'empresa' : number.ownerName;
    const status: string = number.status === 'invalid' ? 'inválido' : number.status;
    const templates: string = number.canSendTemplates ? 'envia modelos' : 'não envia modelos';
    return `${phone}  ${kind}  dono: ${owner}  ${status}  ${templates}`;
}

export async function whatsappNumbers(context: CliContext, options: GlobalOptions): Promise<void> {
    const response: ApiResponse = await clientOf(context, sessionOf(context, options)).request({
        method: 'GET',
        path: '/v1/whatsapp/numbers'
    });
    const list: WhatsAppNumberList = response.body as WhatsAppNumberList;
    if (options.json === true) {
        printJson(context, list);
        return;
    }
    if (list.items.length === 0) {
        printLine(context, 'Nenhum número de WhatsApp conectado.');
        return;
    }
    list.items.forEach((number: WhatsAppNumber) => {
        printLine(context, describe(number));
        if (number.cause !== null) {
            printLine(context, `  Problema: ${number.cause.problem}`);
            printLine(context, `  O que fazer: ${number.cause.action}`);
        }
    });
}
