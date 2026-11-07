import { clientOf, printJson, printLine, printNotice, sessionOf } from '../context.js';
import type { CliContext, GlobalOptions } from '../context.js';
import type { ApiResponse } from '../http/nexo-client.js';

export interface BillingOptions extends GlobalOptions {
    readonly page?: string;
    readonly pageSize?: string;
}

type InvoiceStatus = 'issued' | 'overdue' | 'paid';

interface InvoiceItem {
    readonly invoiceId: string;
    readonly cycleStart: string | null;
    readonly cycleEnd: string | null;
    readonly dueDate: string | null;
    readonly status: InvoiceStatus;
    readonly totalCents: number | null;
    readonly issuedAt: string | null;
    readonly paidAt: string | null;
    readonly paymentMethod: { readonly method: 'card' | 'pix' | 'boleto' } | null;
}

interface InvoiceLine {
    readonly group: string;
    readonly label: string;
    readonly quantity: number;
    readonly unitInCents: number;
    readonly totalInCents: number;
}

interface InvoiceDetail extends InvoiceItem {
    readonly mode: 'self_service' | 'seats';
    readonly lines: readonly InvoiceLine[];
}

interface InvoicePage {
    readonly data: readonly InvoiceItem[];
    readonly pagination: { readonly page: number; readonly pageSize: number; readonly totalRecords: number; readonly totalPages: number };
}

interface Overview {
    readonly billingMode: 'self_service' | 'seats';
    readonly seats: {
        readonly paid: number;
        readonly viewers: number;
        readonly peakInCycle: number;
        readonly contracted: number | null;
        readonly extraPolicy: 'block' | 'charge' | null;
    };
    readonly pricePerSeatInCents: number;
    readonly modules: readonly { readonly displayName: string; readonly priceInCents: number }[];
    readonly monthlyFeeInCents: number;
    readonly ai: { readonly overageAllowed: boolean; readonly usedPercent: number; readonly overageInCents: number };
    readonly meetingRecording: { readonly totalInCents: number };
    readonly status: {
        readonly status: 'active' | 'past_due' | 'suspended';
        readonly graceEndsAt: string | null;
        readonly openInvoice: { readonly invoiceId: string; readonly dueDate: string | null; readonly totalCents: number | null } | null;
        readonly lastChargeFailure: { readonly invoiceId: string; readonly failedAt: string } | null;
    };
    readonly next: {
        readonly date: string;
        readonly estimatedTotalInCents: number;
        readonly lines: readonly { readonly label: string; readonly totalInCents: number }[];
    } | null;
    readonly paymentMethod: {
        readonly verified: boolean;
        readonly brand: string | null;
        readonly lastFourDigits: string | null;
        readonly expiryMonth: number | null;
        readonly expiryYear: number | null;
    };
}

const MODE_LABELS: Readonly<Record<Overview['billingMode'], string>> = {
    self_service: 'autoatendimento (paga pelos assentos usados, depois do ciclo)',
    seats: 'assentos pré-pagos'
};
const STANDING_LABELS: Readonly<Record<Overview['status']['status'], string>> = {
    active: 'em dia',
    past_due: 'em atraso (a conta vira só leitura se nada for pago)',
    suspended: 'suspensa (só leitura, a IA parada)'
};
const INVOICE_LABELS: Readonly<Record<InvoiceStatus, string>> = { issued: 'emitida', overdue: 'vencida', paid: 'paga' };
const METHOD_LABELS: Readonly<Record<'card' | 'pix' | 'boleto', string>> = { card: 'cartão', pix: 'Pix', boleto: 'boleto' };

export function brl(cents: number | null): string {
    if (cents === null) {
        return '—';
    }
    return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function day(value: string | null): string {
    if (value === null) {
        return '—';
    }
    const [year, month, date] = value.slice(0, 10).split('-');
    return `${date ?? ''}/${month ?? ''}/${year ?? ''}`;
}

async function get(context: CliContext, options: BillingOptions, path: string): Promise<unknown> {
    const response: ApiResponse = await clientOf(context, sessionOf(context, options)).request({ method: 'GET', path });
    return response.body;
}

function seatsLine(seats: Overview['seats']): string {
    const contracted: string =
        seats.contracted === null
            ? ''
            : `, ${String(seats.contracted)} contratados (assento extra: ${seats.extraPolicy === 'charge' ? 'cobra' : 'bloqueia'})`;
    return `Assentos: ${String(seats.paid)} em uso${contracted}; pico no ciclo ${String(seats.peakInCycle)}; ${String(seats.viewers)} só leitura`;
}

function standingLines(status: Overview['status']): readonly string[] {
    const lines: string[] = [`Situação: ${STANDING_LABELS[status.status]}`];
    if (status.graceEndsAt !== null) {
        lines.push(`  Prazo até ${day(status.graceEndsAt)}`);
    }
    if (status.openInvoice !== null) {
        lines.push(
            `  Fatura em aberto ${status.openInvoice.invoiceId}: ${brl(status.openInvoice.totalCents)}, vence em ${day(status.openInvoice.dueDate)}`
        );
    }
    if (status.lastChargeFailure !== null) {
        lines.push(`  Cartão recusado em ${day(status.lastChargeFailure.failedAt)} (fatura ${status.lastChargeFailure.invoiceId})`);
    }
    return lines;
}

function cardLine(card: Overview['paymentMethod']): string {
    if (!card.verified) {
        return 'Cartão: nenhum cadastrado';
    }
    const expiry: string =
        card.expiryMonth === null || card.expiryYear === null
            ? ''
            : `, vale ${String(card.expiryMonth).padStart(2, '0')}/${String(card.expiryYear)}`;
    return `Cartão: ${card.brand ?? 'cartão'} final ${card.lastFourDigits ?? '—'}${expiry}`;
}

export function describeOverview(overview: Overview): readonly string[] {
    const lines: string[] = [
        `Modo: ${MODE_LABELS[overview.billingMode]}`,
        seatsLine(overview.seats),
        `Assento: ${brl(overview.pricePerSeatInCents)} por ciclo; mensalidade ${brl(overview.monthlyFeeInCents)}`
    ];
    if (overview.modules.length > 0) {
        lines.push(`Módulos: ${overview.modules.map((item) => `${item.displayName} (${brl(item.priceInCents)})`).join(', ')}`);
    }
    lines.push(
        `IA: ${String(overview.ai.usedPercent)}% do ciclo usado; excedente ${overview.ai.overageAllowed ? 'liberado' : 'desligado'}, ${brl(overview.ai.overageInCents)} até agora`,
        `Gravação de reuniões: ${brl(overview.meetingRecording.totalInCents)} no ciclo`,
        ...standingLines(overview.status),
        cardLine(overview.paymentMethod)
    );
    if (overview.next === null) {
        lines.push('Próximo pagamento: sem assinatura ativa');
        return lines;
    }
    lines.push(`Próximo pagamento: ${brl(overview.next.estimatedTotalInCents)} estimados, ciclo fecha em ${day(overview.next.date)}`);
    overview.next.lines.forEach((line) => lines.push(`  ${line.label}  ${brl(line.totalInCents)}`));
    return lines;
}

export async function billingOverview(context: CliContext, options: BillingOptions): Promise<void> {
    const overview: Overview = (await get(context, options, '/v1/billing')) as Overview;
    if (options.json === true) {
        printJson(context, overview);
        return;
    }
    describeOverview(overview).forEach((line) => {
        printLine(context, line);
    });
}

function invoiceRow(invoice: InvoiceItem): string {
    const cycle: string = invoice.cycleStart === null ? '—' : `${day(invoice.cycleStart)} a ${day(invoice.cycleEnd)}`;
    return `${invoice.invoiceId}  ${INVOICE_LABELS[invoice.status].padEnd(7)} ${brl(invoice.totalCents).padStart(14)}  vence ${day(invoice.dueDate)}  ciclo ${cycle}`;
}

async function invoiceList(context: CliContext, options: BillingOptions): Promise<void> {
    const query: URLSearchParams = new URLSearchParams();
    for (const [key, value] of [
        ['page', options.page],
        ['pageSize', options.pageSize]
    ] as const) {
        if (value !== undefined) {
            query.set(key, value);
        }
    }
    const page: InvoicePage = (await get(
        context,
        options,
        `/v1/billing/invoices${query.size === 0 ? '' : `?${query.toString()}`}`
    )) as InvoicePage;
    if (options.json === true) {
        printJson(context, page);
        return;
    }
    if (page.data.length === 0) {
        printLine(context, 'Nenhuma fatura.');
        return;
    }
    page.data.forEach((invoice) => {
        printLine(context, invoiceRow(invoice));
    });
    if (page.pagination.page < page.pagination.totalPages) {
        printNotice(context, `Página ${String(page.pagination.page)} de ${String(page.pagination.totalPages)}: veja a próxima com --page.`);
    }
}

async function invoiceDetail(context: CliContext, options: BillingOptions, invoiceId: string): Promise<void> {
    const invoice: InvoiceDetail = (await get(context, options, `/v1/billing/invoices/${encodeURIComponent(invoiceId)}`)) as InvoiceDetail;
    if (options.json === true) {
        printJson(context, invoice);
        return;
    }
    printLine(context, `Fatura ${invoice.invoiceId}: ${INVOICE_LABELS[invoice.status]}, ${brl(invoice.totalCents)}`);
    printLine(
        context,
        `Ciclo ${day(invoice.cycleStart)} a ${day(invoice.cycleEnd)}; vence em ${day(invoice.dueDate)}; emitida em ${day(invoice.issuedAt)}`
    );
    if (invoice.paidAt !== null) {
        const method: string = invoice.paymentMethod === null ? '' : ` por ${METHOD_LABELS[invoice.paymentMethod.method]}`;
        printLine(context, `Paga em ${day(invoice.paidAt)}${method}`);
    }
    printLine(context, `Modo: ${MODE_LABELS[invoice.mode]}`);
    let group: string | null = null;
    for (const line of invoice.lines) {
        if (line.group !== group) {
            group = line.group;
            printLine(context, group);
        }
        printLine(context, `  ${line.label}  ${String(line.quantity)} × ${brl(line.unitInCents)} = ${brl(line.totalInCents)}`);
    }
}

export async function billingInvoices(context: CliContext, invoiceId: string | undefined, options: BillingOptions): Promise<void> {
    if (invoiceId === undefined) {
        await invoiceList(context, options);
        return;
    }
    await invoiceDetail(context, options, invoiceId);
}
