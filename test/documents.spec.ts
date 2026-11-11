import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { cliReference } from '../scripts/command-tree.js';
import type { CommandEntry } from '../scripts/command-tree.js';
import { CredentialsStore } from '../src/config/credentials-store.js';
import type { CliContext } from '../src/context.js';
import type { FetchFunction } from '../src/http/nexo-client.js';
import { run } from '../src/run.js';

const API: string = 'https://mcp-nexo.winningsales.com.br';
const FILES: string = 'https://files.example.test';
const DEAL: string = '019fcae7-3e54-755a-8458-bdb605b32401';
const TEMPLATE: string = '019fcae7-3e54-755a-8458-bdb605b324ee';
const DOCUMENT: string = '019fcae7-3e54-755a-8458-bdb605b324c1';
const V1: string = '019fcae7-3e54-755a-8458-bdb605b324d1';
const V2: string = '019fcae7-3e54-755a-8458-bdb605b324d2';
const UPLOAD: string = '019fcae7-3e54-755a-8458-bdb605b324aa';

interface Call {
    readonly method: string;
    readonly url: string;
    readonly path: string;
    readonly body: unknown;
    readonly headers: Readonly<Record<string, string>>;
}

interface Reply {
    readonly status?: number;
    readonly body?: unknown;
    readonly bytes?: string;
}

type Route = Reply | ((call: Call, nth: number) => Reply);

interface Harness {
    readonly context: CliContext;
    readonly calls: Call[];
    readonly sent: (key: string) => Call[];
    readonly out: () => string;
    readonly err: () => string;
    readonly root: string;
}

function bodyOf(init: RequestInit): unknown {
    if (typeof init.body !== 'string') {
        return init.body ?? null;
    }
    return JSON.parse(init.body) as unknown;
}

function responseOf(reply: Reply): Response {
    if (reply.bytes !== undefined) {
        return new Response(reply.bytes, { status: reply.status ?? 200 });
    }
    return new Response(JSON.stringify(reply.body ?? {}), {
        status: reply.status ?? 200,
        headers: { 'content-type': 'application/json' }
    });
}

function harness(routes: Readonly<Record<string, Route>>): Harness {
    const calls: Call[] = [];
    const seen: Map<string, number> = new Map<string, number>();
    const stdout: PassThrough = new PassThrough();
    const stderr: PassThrough = new PassThrough();
    let out: string = '';
    let err: string = '';
    stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    stderr.on('data', (chunk: Buffer) => (err += chunk.toString()));
    const keyOf = (call: Call): string => `${call.method} ${call.url.startsWith(API) ? call.path : call.url}`;
    const fetchFn: FetchFunction = (url: string, init: RequestInit) => {
        const call: Call = {
            method: init.method ?? 'GET',
            url,
            path: url.replace(API, ''),
            body: bodyOf(init),
            headers: (init.headers ?? {}) as Record<string, string>
        };
        calls.push(call);
        const key: string = keyOf(call);
        const nth: number = seen.get(key) ?? 0;
        seen.set(key, nth + 1);
        const route: Route | undefined = routes[key];
        if (route === undefined) {
            return Promise.resolve(responseOf({ status: 404, body: { title: 'Não encontrado', status: 404 } }));
        }
        return Promise.resolve(responseOf(typeof route === 'function' ? route(call, nth) : route));
    };
    return {
        context: {
            store: new CredentialsStore(mkdtempSync(join(tmpdir(), 'nexo-docs-config-'))),
            env: { NEXO_TOKEN: `nexo_pat_${'e'.repeat(38)}` },
            stdin: Readable.from(['']),
            stdout,
            stderr,
            fetchFn,
            openUrl: () => Promise.resolve(false),
            sleep: () => Promise.resolve()
        },
        calls,
        sent: (key: string) => calls.filter((call: Call) => keyOf(call) === key),
        out: () => out,
        err: () => err,
        root: mkdtempSync(join(tmpdir(), 'nexo-docs-'))
    };
}

function field(path: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        path,
        key: path,
        label: path,
        type: 'text',
        required: true,
        options: [],
        allowOther: false,
        box: 'valor',
        role: null,
        value: null,
        text: null,
        words: null,
        refused: null,
        error: null,
        source: null,
        status: 'missing',
        question: null,
        ...overrides
    };
}

function questionnaire(fields: readonly Record<string, unknown>[], pending: readonly unknown[] = []): Record<string, unknown> {
    return {
        questionnaire: {
            agent: 'proposal',
            templateId: TEMPLATE,
            templateName: 'Proposta comercial',
            dealId: DEAL,
            proposal: null,
            documentId: null,
            today: '2026-11-10',
            boxes: [
                { id: 'cliente', title: 'Quem contrata', description: 'A empresa do negócio' },
                { id: 'valor', title: 'Valor e parcelas', description: 'O investimento' }
            ],
            fields,
            groups: [],
            notes: null,
            reading: 'done'
        },
        pending,
        refused: [],
        readingFailure: null
    };
}

const CLIENT: Record<string, unknown> = field('cliente', {
    label: 'Cliente',
    box: 'cliente',
    text: 'Horizonte Ltda',
    status: 'filled',
    source: { kind: 'client', label: 'Empresa do negócio', excerpt: null }
});
const TOTAL_READ: Record<string, unknown> = field('valor_total', {
    label: 'Valor total',
    type: 'money',
    text: 'R$ 184.800,00',
    status: 'filled',
    source: { kind: 'meeting', label: 'Call 04/11', excerpt: 'fechamos em 184.800' }
});
const TOTAL_BLANK: Record<string, unknown> = field('valor_total', { label: 'Valor total', type: 'money' });
const INSTALLMENTS: Record<string, unknown> = field('parcelas', {
    label: 'Parcelas',
    question: {
        text: 'Em quantas parcelas?',
        reason: 'As fontes dizem diferente',
        options: ['12 parcelas', 'entrada de 20% e 10 parcelas']
    }
});
const PENDING: Record<string, unknown> = { path: 'parcelas', label: 'Parcelas', reason: 'missing', sentence: 'Parcelas: falta responder.' };

function version(id: string, number: number, status: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id,
        version: number,
        status,
        failureReason: null,
        changeRequest: null,
        changeSummary: null,
        valueFindings: [],
        checkFindings: [],
        createdAt: '2026-11-10T12:00:00.000Z',
        ...overrides
    };
}

function document(versions: readonly Record<string, unknown>[], overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: DOCUMENT,
        agent: 'proposal',
        number: 'PROP-2026-0043',
        title: 'Proposta Horizonte',
        dealId: DEAL,
        current: versions.at(-1) ?? null,
        acceptance: { state: 'not_accepted', versionId: null, version: null },
        updatedAt: '2026-11-10T12:00:00.000Z',
        versions,
        ...overrides
    };
}

function receipt(versionId: string, number: number, status: string): Record<string, unknown> {
    return { documentId: DOCUMENT, number: 'PROP-2026-0043', title: 'Proposta Horizonte', versionId, version: number, status };
}

function answersFile(h: Harness, answers: readonly Record<string, unknown>[], extra: Record<string, unknown> = {}): string {
    const path: string = join(h.root, 'respostas.json');
    writeFileSync(path, JSON.stringify({ agent: 'proposal', dealId: DEAL, templateId: TEMPLATE, groups: [], answers, ...extra }));
    return path;
}

function find(entry: CommandEntry, path: string): CommandEntry | undefined {
    if (entry.path === path) {
        return entry;
    }
    return entry.commands.map((child) => find(child, path)).find((found) => found !== undefined);
}

describe('nexo documents templates', () => {
    const template: Record<string, unknown> = {
        id: TEMPLATE,
        name: 'Proposta comercial',
        format: 'pptx',
        pageFormat: 'slide_16_9',
        sectionCount: 6,
        contractType: null,
        isDefault: true,
        timesUsed: 4,
        mostUsed: true,
        ownUpload: false
    };

    it('lists the templates of the agent, and says a template is needed when there is none', async () => {
        const full: Harness = harness({
            'GET /v1/agents/proposal/templates': { body: { agent: 'proposal', canAdd: true, templates: [template] } }
        });
        expect(await run(full.context, ['documents', 'templates', '--agent', 'proposal'])).toBe(0);
        expect(full.out()).toContain(`${TEMPLATE}  PPTX  Proposta comercial  (padrão, 6 seções, usado 4 vez(es))`);

        const empty: Harness = harness({
            'GET /v1/agents/contract/templates': { body: { agent: 'contract', canAdd: true, templates: [] } }
        });
        expect(await run(empty.context, ['documents', 'templates', '--agent', 'contract'])).toBe(0);
        expect(empty.out()).toContain('Nenhum modelo.');
        expect(empty.err()).toContain('nexo documents templates add <arquivo> --agent contract');

        const missing: Harness = harness({});
        expect(await run(missing.context, ['documents', 'templates'])).toBe(2);
        expect(missing.calls).toEqual([]);
    });

    it('sends another template through the signed link, without the token, and waits for the reading', async () => {
        const uploaded: Record<string, unknown> = {
            id: TEMPLATE,
            name: 'Contrato',
            fileName: 'contrato.docx',
            shared: false,
            failure: null
        };
        const h: Harness = harness({
            'POST /v1/agents/contract/templates/uploads': {
                status: 201,
                body: {
                    uploadId: UPLOAD,
                    upload: { url: `${FILES}/put`, expiresAt: '2026-11-10T12:15:00Z', method: 'PUT', contentType: 'application/x-docx' }
                }
            },
            [`PUT ${FILES}/put`]: { bytes: '' },
            [`POST /v1/agents/contract/templates/uploads/${UPLOAD}/confirm`]: { status: 202, body: { ...uploaded, state: 'reading' } },
            [`GET /v1/agents/contract/templates/${TEMPLATE}`]: (_call: Call, nth: number) => ({
                body: { ...uploaded, state: nth === 0 ? 'reading' : 'ready' }
            })
        });
        const path: string = join(h.root, 'contrato.docx');
        writeFileSync(path, 'conteúdo');

        expect(await run(h.context, ['documents', 'templates', 'add', path, '--agent', 'contract'])).toBe(0);

        expect(h.sent('POST /v1/agents/contract/templates/uploads')[0]?.body).toEqual({ fileName: 'contrato.docx', sizeInBytes: 9 });
        const put: Call | undefined = h.sent(`PUT ${FILES}/put`)[0];
        expect(put?.headers).toEqual({ 'content-type': 'application/x-docx' });
        expect(Buffer.from(put?.body as Uint8Array).toString()).toBe('conteúdo');
        expect(h.sent(`GET /v1/agents/contract/templates/${TEMPLATE}`)).toHaveLength(2);
        expect(h.out()).toContain(`${TEMPLATE}  Contrato  modelo lido`);
        expect(h.err()).toContain('vale só para você');
    });

    it('fails when the reading of the uploaded template fails, and downloads the source file of a template', async () => {
        const failed: Harness = harness({
            'POST /v1/agents/proposal/templates/uploads': {
                status: 201,
                body: { uploadId: UPLOAD, upload: { url: `${FILES}/put`, contentType: 'text/html' } }
            },
            [`PUT ${FILES}/put`]: { bytes: '' },
            [`POST /v1/agents/proposal/templates/uploads/${UPLOAD}/confirm`]: {
                status: 202,
                body: { id: TEMPLATE, name: 'Modelo', fileName: 'm.html', shared: true, state: 'failed', failure: 'O modelo está vazio' }
            }
        });
        const source: string = join(failed.root, 'm.html');
        writeFileSync(source, '<p>x</p>');
        expect(await run(failed.context, ['documents', 'templates', 'add', source, '--agent', 'proposal'])).toBe(1);
        expect(failed.err()).toContain('O modelo está vazio');

        const h: Harness = harness({
            [`GET /v1/agents/proposal/templates/${TEMPLATE}/source`]: {
                body: { url: `${FILES}/get`, expiresAt: '2026-11-10T12:15:00Z', fileName: '../modelo.pptx', format: 'pptx' }
            },
            [`GET ${FILES}/get`]: { bytes: 'arquivo do modelo' }
        });
        const target: string = join(h.root, 'baixado.pptx');
        expect(await run(h.context, ['documents', 'templates', 'download', TEMPLATE, '--agent', 'proposal', '-o', target])).toBe(0);
        expect(readFileSync(target, 'utf8')).toBe('arquivo do modelo');
        expect(h.sent(`GET ${FILES}/get`)[0]?.headers).toEqual({});
        expect(h.out().trim()).toBe(target);
    });
});

describe('nexo documents questionnaire', () => {
    it('prints the blocks, the value with its source and what is missing, and writes the answers file', async () => {
        const h: Harness = harness({
            'POST /v1/agents/proposal/questionnaire': { body: questionnaire([CLIENT, TOTAL_READ, INSTALLMENTS], [PENDING]) }
        });
        const output: string = join(h.root, 'respostas.json');

        expect(
            await run(h.context, [
                'documents',
                'questionnaire',
                '--agent',
                'proposal',
                '--deal',
                DEAL,
                '--template',
                TEMPLATE,
                '-o',
                output
            ])
        ).toBe(0);

        expect(h.calls[0]?.body).toEqual({
            dealId: DEAL,
            templateId: TEMPLATE,
            proposalDocumentId: null,
            documentId: null,
            dealReading: true
        });
        const out: string = h.out();
        expect(out).toContain('Quem contrata — A empresa do negócio');
        expect(out).toContain('  Cliente [cliente]: Horizonte Ltda  (Empresa do negócio)');
        expect(out).toContain('  Valor total [valor_total]: R$ 184.800,00  (Call 04/11)');
        expect(out).toContain('  Parcelas [parcelas]: falta responder');
        expect(out).toContain(
            'Pergunta: Em quantas parcelas? (As fontes dizem diferente) Opções: 12 parcelas | entrada de 20% e 10 parcelas'
        );
        expect(out).toContain('Falta:\n  - Parcelas: falta responder.');
        const file: Record<string, unknown> = JSON.parse(readFileSync(output, 'utf8')) as Record<string, unknown>;
        expect(file).toMatchObject({ agent: 'proposal', dealId: DEAL, templateId: TEMPLATE, groups: [] });
        expect(file.answers).toEqual([
            { path: 'cliente', label: 'Cliente', type: 'text', required: true, text: 'Horizonte Ltda', source: 'Empresa do negócio' },
            { path: 'valor_total', label: 'Valor total', type: 'money', required: true, text: 'R$ 184.800,00', source: 'Call 04/11' },
            {
                path: 'parcelas',
                label: 'Parcelas',
                type: 'text',
                required: true,
                text: null,
                source: null,
                question: 'Em quantas parcelas?',
                options: ['12 parcelas', 'entrada de 20% e 10 parcelas']
            }
        ]);
    });

    it('skips the reading of the conversations with --no-reading and prints the API answer with --json', async () => {
        const body: Record<string, unknown> = questionnaire([CLIENT]);
        const h: Harness = harness({ 'POST /v1/agents/contract/questionnaire': { body } });

        expect(
            await run(h.context, ['documents', 'questionnaire', '--agent', 'contract', '--template', TEMPLATE, '--no-reading', '--json'])
        ).toBe(0);

        expect(h.calls[0]?.body).toMatchObject({ dealId: null, dealReading: false });
        expect(JSON.parse(h.out())).toEqual(body);
    });
});

describe('nexo documents create', () => {
    it('sends only the answers the Nexo does not fill by itself, waits for the version and shows each state once', async () => {
        const h: Harness = harness({
            'POST /v1/agents/proposal/questionnaire': { body: questionnaire([CLIENT, TOTAL_BLANK, INSTALLMENTS], [PENDING]) },
            'POST /v1/agents/proposal/documents': { status: 202, body: receipt(V1, 1, 'queued') },
            [`GET /v1/agents/documents/${DOCUMENT}`]: (_call: Call, nth: number) => ({
                body: document([version(V1, 1, ['queued', 'running', 'running', 'ready'][nth] ?? 'ready')])
            })
        });
        const answers: string = answersFile(
            h,
            [
                { path: 'cliente', text: 'Horizonte Ltda' },
                { path: 'valor_total', text: 'R$ 184.800,00' },
                { path: 'parcelas', text: ' 12 parcelas ' }
            ],
            { notes: 'Tom direto' }
        );

        expect(await run(h.context, ['documents', 'create', '--answers', answers])).toBe(0);

        expect(h.sent('POST /v1/agents/proposal/questionnaire')[0]?.body).toMatchObject({
            dealId: DEAL,
            templateId: TEMPLATE,
            dealReading: false
        });
        expect(h.sent('POST /v1/agents/proposal/documents')[0]?.body).toEqual({
            dealId: DEAL,
            templateId: TEMPLATE,
            proposalDocumentId: null,
            answers: [
                { path: 'valor_total', text: 'R$ 184.800,00' },
                { path: 'parcelas', text: '12 parcelas' }
            ],
            groups: [],
            notes: 'Tom direto'
        });
        expect(h.err()).toBe('Versão 1: na fila.\nVersão 1: o Nexo está escrevendo.\nVersão 1: pronta.\n');
        expect(h.out()).toContain(`${DOCUMENT}  PROP-2026-0043  versão 1 pronta  Proposta Horizonte`);
    });

    it('exits with a failing code and lists what is missing when a required answer is not there', async () => {
        const problem: Record<string, unknown> = {
            type: 'agents.questionnaire_incomplete',
            title: 'Não foi possível concluir',
            status: 422,
            detail: 'O questionário ainda não fecha: Parcelas: falta responder.',
            requestId: 'req-1',
            meta: { pending: [PENDING], summary: 'Parcelas: falta responder.' }
        };
        const routes: Readonly<Record<string, Route>> = { 'POST /v1/agents/proposal/documents': { status: 422, body: problem } };
        const text: Harness = harness(routes);
        const args: readonly string[] = ['documents', 'create', '--agent', 'proposal', '--deal', DEAL, '--template', TEMPLATE];

        expect(await run(text.context, args)).toBe(1);
        expect(text.err()).toContain('Erro: Não foi possível concluir: O questionário ainda não fecha');
        expect(text.err()).toContain('  - Parcelas: falta responder.');
        expect(text.out()).toBe('');

        const json: Harness = harness(routes);
        expect(await run(json.context, [...args, '--json'])).toBe(1);
        expect(JSON.parse(json.err())).toMatchObject({
            type: 'agents.questionnaire_incomplete',
            status: 422,
            meta: { pending: [PENDING] }
        });
    });

    it('returns right away with --no-wait, and needs the agent and the template', async () => {
        const h: Harness = harness({ 'POST /v1/agents/contract/documents': { status: 202, body: receipt(V1, 1, 'queued') } });

        expect(await run(h.context, ['documents', 'create', '--agent', 'contract', '--template', TEMPLATE, '--no-wait', '--json'])).toBe(0);

        expect(h.calls).toHaveLength(1);
        expect(JSON.parse(h.out())).toEqual(receipt(V1, 1, 'queued'));
        expect(h.err()).toContain(`nexo documents get ${DOCUMENT}`);

        const usage: Harness = harness({});
        expect(await run(usage.context, ['documents', 'create', '--agent', 'contract'])).toBe(2);
        expect(await run(usage.context, ['documents', 'create', '--template', TEMPLATE])).toBe(2);
        expect(usage.calls).toEqual([]);
    });

    it('sends the document already written, with the adaptations, and shows what did not pass the check', async () => {
        const h: Harness = harness({ 'POST /v1/agents/contract/documents/written': { status: 201, body: receipt(V1, 1, 'ready') } });
        const html: string = join(h.root, 'contrato.html');
        const adaptations: string = join(h.root, 'adaptacoes.json');
        writeFileSync(html, '<h1>Contrato</h1>');
        writeFileSync(adaptations, JSON.stringify([{ kind: 'removed', clause: '7', note: 'Sem fiador' }]));

        expect(
            await run(h.context, [
                'documents',
                'create',
                '--agent',
                'contract',
                '--template',
                TEMPLATE,
                '--document',
                html,
                '--adaptations',
                adaptations
            ])
        ).toBe(0);

        expect(h.calls[0]?.body).toMatchObject({
            templateId: TEMPLATE,
            answers: [],
            html: '<h1>Contrato</h1>',
            adaptations: [{ kind: 'removed', clause: '7', note: 'Sem fiador' }]
        });
        expect(h.out()).toContain('versão 1 pronta');

        const refused: Harness = harness({
            'POST /v1/agents/proposal/documents/written': {
                status: 422,
                body: {
                    type: 'agents.written_document_refused',
                    title: 'Não foi possível concluir',
                    status: 422,
                    meta: { findings: ['O documento traz R$ 180.000,00, que não está nas respostas.'] }
                }
            }
        });
        writeFileSync(join(refused.root, 'p.html'), '<p>R$ 180.000,00</p>');
        expect(
            await run(refused.context, [
                'documents',
                'create',
                '--agent',
                'proposal',
                '--template',
                TEMPLATE,
                '--document',
                join(refused.root, 'p.html')
            ])
        ).toBe(1);
        expect(refused.err()).toContain('  - O documento traz R$ 180.000,00, que não está nas respostas.');
    });

    it('fails with the findings when the version does not pass the check of values', async () => {
        const failed: Record<string, unknown> = version(V1, 1, 'failed', {
            failureReason: 'values_mismatch',
            valueFindings: ['O documento traz R$ 180.000,00, que não está nas respostas.']
        });
        const h: Harness = harness({
            'POST /v1/agents/proposal/documents': { status: 202, body: receipt(V1, 1, 'queued') },
            [`GET /v1/agents/documents/${DOCUMENT}`]: { body: document([failed]) }
        });

        expect(await run(h.context, ['documents', 'create', '--agent', 'proposal', '--template', TEMPLATE])).toBe(1);

        expect(h.err()).toContain('  - O documento traz R$ 180.000,00, que não está nas respostas.');
        expect(h.err()).toContain('Erro: A versão 1 não saiu: a conferência achou valor, data ou prazo que não bate com as respostas.');
    });

    it('gives up after the timeout and says how to follow the version', async () => {
        const h: Harness = harness({
            'POST /v1/agents/proposal/documents': { status: 202, body: receipt(V1, 1, 'queued') },
            [`GET /v1/agents/documents/${DOCUMENT}`]: { body: document([version(V1, 1, 'running')]) }
        });

        expect(await run(h.context, ['documents', 'create', '--agent', 'proposal', '--template', TEMPLATE, '--timeout', '8'])).toBe(1);

        expect(h.sent(`GET /v1/agents/documents/${DOCUMENT}`)).toHaveLength(3);
        expect(h.err()).toContain(`nexo documents get ${DOCUMENT}`);
    });
});

describe('nexo documents revise, accept, pdf and docx', () => {
    it('sends a new version already written with --document alone, to the written route', async () => {
        const h: Harness = harness({
            [`POST /v1/agents/documents/${DOCUMENT}/versions/written`]: { status: 201, body: receipt(V2, 2, 'ready') }
        });
        const html: string = join(h.root, 'v2.html');
        writeFileSync(html, '<h1>Proposta</h1>');

        expect(await run(h.context, ['documents', 'revise', DOCUMENT, '--document', html])).toBe(0);

        expect(h.calls).toHaveLength(1);
        expect(h.calls[0]?.body).toEqual({ templateId: null, request: null, answers: [], groups: [], html: '<h1>Proposta</h1>' });
        expect(h.out()).toContain('versão 2 pronta');
    });

    it('tells the AI limit of the company apart from the limit of calls and from the limit of files', async () => {
        const budget: Harness = harness({
            [`POST /v1/agents/documents/${DOCUMENT}/versions`]: {
                status: 429,
                body: {
                    type: 'agents.writing_budget',
                    title: 'AgentWritingBudgetError',
                    status: 429,
                    detail: 'O limite de IA deste ciclo acabou.'
                }
            }
        });
        expect(await run(budget.context, ['documents', 'revise', DOCUMENT, '--request', 'deixa mais direto'])).toBe(6);
        expect(budget.err()).toContain('O limite de IA deste ciclo acabou.');
        expect(budget.err()).not.toContain('somando todos os tokens');

        const files: Harness = harness({
            [`GET /v1/agents/documents/${DOCUMENT}`]: { body: document([version(V1, 1, 'ready')]) },
            [`POST /v1/agents/documents/${DOCUMENT}/versions/${V1}/pdf`]: {
                status: 429,
                body: { type: 'core.too_many_attempts', title: 'TooManyAttemptsError', status: 429, detail: 'Muitas tentativas.' }
            }
        });
        expect(await run(files.context, ['documents', 'pdf', DOCUMENT])).toBe(6);
        expect(files.err()).toContain('somado ao do app');
        expect(files.err()).not.toContain('somando todos os tokens');
    });

    it('asks for a new version with the request as it was said, and tells what changed', async () => {
        const second: Record<string, unknown> = version(V2, 2, 'ready', {
            changeRequest: 'deixa mais direto',
            changeSummary: 'Encurtei a abertura.'
        });
        const h: Harness = harness({
            [`POST /v1/agents/documents/${DOCUMENT}/versions`]: { status: 202, body: receipt(V2, 2, 'queued') },
            [`GET /v1/agents/documents/${DOCUMENT}`]: { body: document([version(V1, 1, 'ready'), second]) }
        });

        expect(await run(h.context, ['documents', 'revise', DOCUMENT, '--request', 'deixa mais direto'])).toBe(0);

        expect(h.calls[0]?.body).toEqual({ templateId: null, request: 'deixa mais direto', answers: [], groups: [] });
        expect(h.out()).toContain('versão 2 pronta');
        expect(h.out()).toContain('O que mudou: Encurtei a abertura.');

        const usage: Harness = harness({});
        expect(await run(usage.context, ['documents', 'revise', DOCUMENT])).toBe(2);
        expect(usage.calls).toEqual([]);
    });

    it('sends only the answers that changed against the current version of the document', async () => {
        const carried: Record<string, unknown> = field('parcelas', { label: 'Parcelas', text: '12 parcelas', status: 'filled' });
        const h: Harness = harness({
            [`GET /v1/agents/documents/${DOCUMENT}`]: { body: document([version(V1, 1, 'ready')]) },
            'POST /v1/agents/proposal/questionnaire': { body: questionnaire([CLIENT, TOTAL_READ, carried]) },
            [`POST /v1/agents/documents/${DOCUMENT}/versions`]: { status: 202, body: receipt(V2, 2, 'queued') }
        });
        const answers: string = answersFile(h, [
            { path: 'valor_total', text: 'R$ 184.800,00' },
            { path: 'parcelas', text: '10 parcelas' }
        ]);

        expect(await run(h.context, ['documents', 'revise', DOCUMENT, '--answers', answers, '--no-wait'])).toBe(0);

        expect(h.sent('POST /v1/agents/proposal/questionnaire')[0]?.body).toEqual({
            dealId: DEAL,
            templateId: null,
            proposalDocumentId: null,
            documentId: DOCUMENT,
            dealReading: false
        });
        expect(h.sent(`POST /v1/agents/documents/${DOCUMENT}/versions`)[0]?.body).toEqual({
            templateId: null,
            request: null,
            answers: [{ path: 'parcelas', text: '10 parcelas' }],
            groups: []
        });
    });

    it('accepts the current version, or the one asked by number', async () => {
        const versions: readonly Record<string, unknown>[] = [version(V1, 1, 'ready'), version(V2, 2, 'ready')];
        const routes: Readonly<Record<string, Route>> = {
            [`GET /v1/agents/documents/${DOCUMENT}`]: { body: document(versions) },
            [`POST /v1/agents/documents/${DOCUMENT}/versions/${V2}/acceptance`]: { body: document(versions) },
            [`POST /v1/agents/documents/${DOCUMENT}/versions/${V1}/acceptance`]: { body: document(versions) }
        };
        const current: Harness = harness(routes);
        expect(await run(current.context, ['documents', 'accept', DOCUMENT])).toBe(0);
        expect(current.out()).toContain('Versão 2 aceita');
        expect(current.sent(`POST /v1/agents/documents/${DOCUMENT}/versions/${V2}/acceptance`)).toHaveLength(1);

        const first: Harness = harness(routes);
        expect(await run(first.context, ['documents', 'accept', DOCUMENT, '--version-number', '1'])).toBe(0);
        expect(first.sent(`POST /v1/agents/documents/${DOCUMENT}/versions/${V1}/acceptance`)).toHaveLength(1);

        const absent: Harness = harness(routes);
        expect(await run(absent.context, ['documents', 'accept', DOCUMENT, '--version-number', '9'])).toBe(5);
        expect(absent.calls).toHaveLength(1);
    });

    it('downloads the PDF and the DOCX of a version from the signed link', async () => {
        const h: Harness = harness({
            [`GET /v1/agents/documents/${DOCUMENT}`]: { body: document([version(V1, 1, 'ready')]) },
            [`POST /v1/agents/documents/${DOCUMENT}/versions/${V1}/pdf`]: {
                body: { url: `${FILES}/pdf`, expiresAt: '2026-11-10T12:15:00Z', fileName: 'Proposta-Horizonte-v1.pdf' }
            },
            [`POST /v1/agents/documents/${DOCUMENT}/versions/${V1}/docx`]: {
                body: { url: `${FILES}/docx`, expiresAt: '2026-11-10T12:15:00Z' }
            },
            [`GET ${FILES}/pdf`]: { bytes: '%PDF-1.7' },
            [`GET ${FILES}/docx`]: { bytes: 'PK' }
        });
        const pdf: string = join(h.root, 'proposta.pdf');
        const docx: string = join(h.root, 'contrato.docx');

        expect(await run(h.context, ['documents', 'pdf', DOCUMENT, '-o', pdf])).toBe(0);
        expect(await run(h.context, ['documents', 'docx', DOCUMENT, '-o', docx, '--json'])).toBe(0);

        expect(readFileSync(pdf, 'utf8')).toBe('%PDF-1.7');
        expect(readFileSync(docx, 'utf8')).toBe('PK');
        expect(h.out()).toContain(`${pdf}\n`);
        expect(h.out()).toContain(`"path": "${docx}"`);
    });

    it('lists the documents and shows one with its versions', async () => {
        const failed: Record<string, unknown> = version(V2, 2, 'failed', { failureReason: 'budget' });
        const h: Harness = harness({
            [`GET /v1/agents/documents?agent=proposal&dealId=${DEAL}`]: { body: { items: [document([version(V1, 1, 'ready')])] } },
            [`GET /v1/agents/documents/${DOCUMENT}`]: { body: document([version(V1, 1, 'ready'), failed]) }
        });

        expect(await run(h.context, ['documents', 'list', '--agent', 'proposal', '--deal', DEAL])).toBe(0);
        expect(h.out()).toContain(`${DOCUMENT}  proposta PROP-2026-0043 v1 pronta  rascunho  Proposta Horizonte`);

        expect(await run(h.context, ['documents', 'get', DOCUMENT])).toBe(0);
        expect(h.out()).toContain('  v2  não saiu   (budget)');
        expect(h.out()).toContain('A versão 2 não saiu: o limite de IA do ciclo da empresa acabou e nada foi escrito.');
    });
});

describe('nexo documents negotiate', () => {
    const routes: Readonly<Record<string, Route>> = {
        [`GET /v1/agents/documents/${DOCUMENT}`]: { body: document([version(V1, 1, 'ready')]) },
        [`POST /v1/agents/documents/${DOCUMENT}/negotiation`]: { status: 201, body: { id: 'neg-1', status: 'open' } }
    };
    const args: readonly string[] = [
        'documents',
        'negotiate',
        DOCUMENT,
        '--person',
        'Renata Lima <Renata@Horizonte.com.br>',
        '--person',
        'compras@horizonte.com.br',
        '--approver',
        'renata@horizonte.com.br',
        '--message',
        'Segue a proposta'
    ];

    it('shows who gets the e-mail and sends nothing without the yes', async () => {
        const h: Harness = harness(routes);

        expect(await run(h.context, args)).toBe(0);

        expect(h.out()).toContain('Começar a negociação de PROP-2026-0043 "Proposta Horizonte", versão 1.');
        expect(h.out()).toContain('  - Renata Lima <renata@horizonte.com.br>  (aprova)');
        expect(h.out()).toContain('  - <compras@horizonte.com.br>');
        expect(h.err()).toContain('rode de novo com --yes');
        expect(h.calls.map((call: Call) => call.method)).toEqual(['GET']);
    });

    it('starts the negotiation with --yes, with exactly one person approving', async () => {
        const h: Harness = harness(routes);

        expect(await run(h.context, [...args, '--yes'])).toBe(0);

        expect(h.sent(`POST /v1/agents/documents/${DOCUMENT}/negotiation`)[0]?.body).toEqual({
            people: [
                { name: 'Renata Lima', email: 'renata@horizonte.com.br', approver: true },
                { name: null, email: 'compras@horizonte.com.br', approver: false }
            ],
            message: 'Segue a proposta',
            versionId: V1
        });
        expect(h.out()).toContain('Negociação aberta: 2 pessoa(s) receberam o link por e-mail.');
    });

    it('refuses a malformed person and a negotiation with nobody approving, before any call', async () => {
        const h: Harness = harness(routes);

        expect(await run(h.context, ['documents', 'negotiate', DOCUMENT, '--person', 'Renata', '--approver', 'a@b.co', '--yes'])).toBe(2);
        expect(await run(h.context, ['documents', 'negotiate', DOCUMENT, '--person', 'a@b.co', '--yes'])).toBe(2);

        expect(h.calls).toEqual([]);
    });
});

describe('nexo documents in the command tree', () => {
    it('lists the group with its subcommands for the public reference', () => {
        const group: CommandEntry | undefined = find(cliReference().program, 'nexo documents');

        expect(group?.aliases).toEqual(['documentos']);
        expect(group?.commands.map((command: CommandEntry) => command.name)).toEqual([
            'templates',
            'list',
            'get',
            'questionnaire',
            'create',
            'revise',
            'accept',
            'pdf',
            'docx',
            'negotiate'
        ]);
        expect(find(cliReference().program, 'nexo documents templates add')?.options.map((option) => option.flags)).toContain(
            '--agent <agente>'
        );
    });
});
