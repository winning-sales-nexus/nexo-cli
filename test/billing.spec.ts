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
const INVOICE: string = '0192b2f0-0000-7000-8000-000000000003';

const OVERVIEW: unknown = {
    billingMode: 'seats',
    seats: { paid: 8, viewers: 2, peakInCycle: 9, contracted: 10, extraPolicy: 'charge' },
    pricePerSeatInCents: 15000,
    addonsInCents: 5000,
    modules: [{ name: 'copilot', displayName: 'Copiloto', priceInCents: 5000, since: '2026-10-01T00:00:00Z' }],
    monthlyFeeInCents: 155000,
    fixedPerCycleInCents: 155000,
    ai: { overageAllowed: true, usedPercent: 112, overageInCents: 2500 },
    meetingRecording: { totalInCents: 900 },
    subscription: { status: 'active', chargeDay: 10 },
    profileComplete: true,
    status: {
        status: 'past_due',
        reason: 'invoice_overdue',
        since: '2026-11-01T00:00:00Z',
        graceEndsAt: '2026-11-15T00:00:00Z',
        openInvoice: { invoiceId: INVOICE, status: 'overdue', dueDate: '2026-11-05', totalCents: 155000 },
        lastChargeFailure: { invoiceId: INVOICE, failedAt: '2026-11-05T12:00:00Z' }
    },
    invoices: [],
    next: {
        date: '2026-12-10',
        seatFeeInCents: 140000,
        meetingRecordingInCents: 900,
        estimatedTotalInCents: 143400,
        lines: [{ kind: 'seats', label: '10 assentos', quantity: 10, unitInCents: 14000, totalInCents: 140000 }]
    },
    paymentMethod: { verified: true, brand: 'visa', lastFourDigits: '4242', expiryMonth: 3, expiryYear: 2029 }
};

const ITEM: Record<string, unknown> = {
    invoiceId: INVOICE,
    cycleStart: '2026-10-10',
    cycleEnd: '2026-11-10',
    dueDate: '2026-11-05',
    status: 'paid',
    totalCents: 155000,
    issuedAt: '2026-10-28T10:00:00Z',
    paidAt: '2026-11-01T10:00:00Z',
    paymentMethod: { method: 'pix' }
};

interface Harness {
    readonly context: CliContext;
    readonly paths: string[];
    readonly out: () => string;
    readonly err: () => string;
}

function harness(routes: Readonly<Record<string, { status?: number; body: unknown }>>): Harness {
    const paths: string[] = [];
    const stdout: PassThrough = new PassThrough();
    const stderr: PassThrough = new PassThrough();
    let out: string = '';
    let err: string = '';
    stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    stderr.on('data', (chunk: Buffer) => (err += chunk.toString()));
    const fetchFn: FetchFunction = (url: string) => {
        const path: string = url.replace(API, '');
        paths.push(path);
        const route: { status?: number; body: unknown } = routes[path] ?? { status: 404, body: { title: 'Não encontrado', status: 404 } };
        return Promise.resolve(
            new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers: { 'content-type': 'application/json' } })
        );
    };
    const context: CliContext = {
        store: new CredentialsStore(mkdtempSync(join(tmpdir(), 'nexo-billing-'))),
        env: { NEXO_TOKEN: `nexo_pat_${'d'.repeat(38)}` },
        stdin: Readable.from(['']),
        stdout,
        stderr,
        fetchFn,
        openUrl: () => Promise.resolve(false)
    };
    return { context, paths, out: () => out, err: () => err };
}

describe('nexo billing', () => {
    it('summarizes the plan and the next payment in Portuguese', async () => {
        const h: Harness = harness({ '/v1/billing': { body: OVERVIEW } });

        expect(await run(h.context, ['billing'])).toBe(0);

        const out: string = h.out();
        expect(out).toContain('Modo: assentos pré-pagos');
        expect(out).toContain('10 contratados (assento extra: cobra)');
        expect(out).toContain('Copiloto');
        expect(out).toContain('IA: 112% do ciclo usado');
        expect(out).toContain('em atraso');
        expect(out).toContain('Cartão recusado em 05/11/2026');
        expect(out).toContain('Cartão: visa final 4242, vale 03/2029');
        expect(out).toMatch(/Próximo pagamento: R\$\s1\.434,00 estimados, ciclo fecha em 10\/12\/2026/);
        expect(h.paths).toEqual(['/v1/billing']);
    });

    it('says when there is no card and no subscription, and prints the API answer with --json', async () => {
        const bare: Record<string, unknown> = {
            ...(OVERVIEW as Record<string, unknown>),
            next: null,
            paymentMethod: { verified: false, brand: null, lastFourDigits: null, expiryMonth: null, expiryYear: null }
        };
        const text: Harness = harness({ '/v1/billing': { body: bare } });
        await run(text.context, ['billing']);
        expect(text.out()).toContain('Cartão: nenhum cadastrado');
        expect(text.out()).toContain('Próximo pagamento: sem assinatura ativa');

        const json: Harness = harness({ '/v1/billing': { body: bare } });
        await run(json.context, ['billing', '--json']);
        expect(JSON.parse(json.out())).toEqual(bare);
    });

    it('lists the invoices, passes the page, and points to the next page', async () => {
        const h: Harness = harness({
            '/v1/billing/invoices?page=2&pageSize=1': {
                body: { data: [ITEM], pagination: { page: 2, pageSize: 1, totalRecords: 3, totalPages: 3 } }
            }
        });

        expect(await run(h.context, ['billing', 'invoices', '--page', '2', '--page-size', '1'])).toBe(0);

        expect(h.out()).toMatch(new RegExp(`${INVOICE}  paga\\s+R\\$\\s1\\.550,00  vence 05/11/2026  ciclo 10/10/2026 a 10/11/2026`));
        expect(h.err()).toContain('Página 2 de 3');
    });

    it('shows one invoice with its lines grouped', async () => {
        const h: Harness = harness({
            [`/v1/billing/invoices/${INVOICE}`]: {
                body: {
                    ...ITEM,
                    mode: 'seats',
                    lines: [
                        {
                            group: 'Ciclo de dezembro, pago adiantado',
                            kind: 'seats',
                            label: 'Assentos',
                            quantity: 10,
                            unitInCents: 14000,
                            totalInCents: 140000
                        },
                        {
                            group: 'Ciclo de dezembro, pago adiantado',
                            kind: 'module',
                            label: 'Copiloto',
                            quantity: 1,
                            unitInCents: 5000,
                            totalInCents: 5000
                        }
                    ]
                }
            }
        });

        expect(await run(h.context, ['billing', 'invoices', INVOICE])).toBe(0);

        const out: string = h.out();
        expect(out).toContain(`Fatura ${INVOICE}: paga`);
        expect(out).toContain('Paga em 01/11/2026 por Pix');
        expect(out.match(/Ciclo de dezembro, pago adiantado/g)).toHaveLength(1);
        expect(out).toMatch(/Assentos {2}10 × R\$\s140,00 = R\$\s1\.400,00/);
    });

    it('turns a missing invoice into the not-found exit code', async () => {
        const h: Harness = harness({});

        expect(await run(h.context, ['billing', 'invoices', INVOICE])).toBe(5);
    });

    it('has Portuguese help for the command and its invoices subcommand', async () => {
        const h: Harness = harness({});

        await run(h.context, ['billing', '--help']);
        await run(h.context, ['billing', 'invoices', '--help']);

        expect(h.out()).toContain('Plano e cobrança da empresa, só leitura');
        expect(h.out()).toContain('mostra a ajuda');
        expect(h.out()).toContain('id da fatura (UUID), para ver as linhas');
        expect(h.out()).toContain('--page-size <n>');
    });
});
