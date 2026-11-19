import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { CredentialsStore } from '../src/config/credentials-store.js';
import type { CliContext } from '../src/context.js';
import type { FetchFunction } from '../src/http/nexo-client.js';
import { run } from '../src/run.js';

const API: string = 'https://mcp-nexo.winningsales.com.br';

interface Call {
    readonly method: string;
    readonly path: string;
    readonly body: unknown;
}

interface Harness {
    readonly context: CliContext;
    readonly calls: Call[];
    readonly out: () => string;
    readonly err: () => string;
}

function harness(routes: Readonly<Record<string, { status?: number; body: unknown }>>, stdinText: string = ''): Harness {
    const calls: Call[] = [];
    const stdout: PassThrough = new PassThrough();
    const stderr: PassThrough = new PassThrough();
    let out: string = '';
    let err: string = '';
    stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    stderr.on('data', (chunk: Buffer) => (err += chunk.toString()));
    const fetchFn: FetchFunction = (url: string, init?: RequestInit) => {
        const path: string = url.replace(API, '');
        const method: string = init?.method ?? 'GET';
        calls.push({ method, path, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
        const route: { status?: number; body: unknown } = routes[`${method} ${path}`] ?? {
            status: 404,
            body: { title: 'Não encontrado', status: 404 }
        };
        return Promise.resolve(
            new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers: { 'content-type': 'application/json' } })
        );
    };
    const context: CliContext = {
        store: new CredentialsStore(mkdtempSync(join(tmpdir(), 'nexo-templates-'))),
        env: { NEXO_TOKEN: `nexo_pat_${'d'.repeat(38)}` },
        stdin: Readable.from([stdinText]),
        stdout,
        stderr,
        fetchFn,
        openUrl: () => Promise.resolve(false)
    };
    return { context, calls, out: () => out, err: () => err };
}

const ID: string = '0192b2f0-0000-7000-8000-0000000000b1';

const LEGACY: Record<string, unknown> = {
    id: ID,
    channel: 'email',
    name: 'Boas-vindas',
    state: 'draft',
    currentSeq: 3,
    fromKit: true,
    content: {
        subject: 'Bem-vindo, {{contato_nome}}',
        body: '',
        footer: null,
        document: { schemaVersion: 1, json: { type: 'doc', content: [{ type: 'paragraph' }] } }
    },
    rules: [{ flowId: 'f1', name: 'Boas-vindas ao lead', status: 'active', sendsAutomatically: true }],
    createdAt: '2026-11-18T10:00:00Z',
    updatedAt: '2026-11-18T11:00:00Z'
};
const STRUCTURED: Record<string, unknown> = {
    ...LEGACY,
    content: {
        ...(LEGACY['content'] as Record<string, unknown>),
        document: { schemaVersion: 1, json: { type: 'doc', content: [{ type: 'section' }] } }
    }
};
const BRAND_MISSING: Record<string, unknown> = {
    identidade: 'parcial',
    falta: ['logo'],
    onde: 'Agentes › Configurar › Identidade visual',
    caminho: '/agents/configure/visual-identity'
};
const STRUCTURE_BRAND_MISSING: Record<string, unknown> = {
    identity: 'partial',
    missing: ['logo'],
    moduleEnabled: true,
    text: 'Falta o logo. Cadastre em Agentes › Configurar › Identidade visual.'
};
const STRUCTURE_BRAND_COMPLETE: Record<string, unknown> = { identity: 'complete', missing: [], moduleEnabled: true, text: null };
const CARD: Record<string, unknown> = {
    title: 'Criar o rascunho do modelo Boas-vindas',
    details: ['Canal: e-mail'],
    change: {
        kind: 'message_template_change',
        action: 'create',
        templateId: null,
        channel: 'email',
        name: 'Boas-vindas',
        problems: [],
        changes: ['entra: cabeçalho com o logo'],
        previews: [{ sample: 'Acme', subject: 'Olá, Acme', body: 'Olá', footer: null, missingVariables: [], html: '<p>email</p>' }],
        variables: [],
        brand: BRAND_MISSING
    },
    confirmation: { token: 'tok-123', expiresAt: '2026-11-18T12:00:00Z' }
};
const APPLIED: Record<string, unknown> = {
    ok: true,
    modelo: 'Boas-vindas',
    situacao: 'draft',
    versao: 1,
    mensagem: 'Rascunho criado',
    marca: BRAND_MISSING,
    formato: 'formato_antigo',
    avisoFormato: 'O modelo está no formato antigo.'
};
const CHANGES_PREVIEW: string = 'POST /v1/message-template-changes/preview';
const CHANGES_APPLY: string = 'POST /v1/message-template-changes/apply';

function directory(): string {
    return mkdtempSync(join(tmpdir(), 'nexo-templates-files-'));
}

describe('nexo templates list and get', () => {
    it('lists the library with the filters, and answers to the Portuguese alias', async () => {
        const path: string = '/v1/message-templates?channel=email&state=draft';
        const h: Harness = harness({ [`GET ${path}`]: { body: { items: [LEGACY] } } });

        expect(await run(h.context, ['modelos', 'list', '--channel', 'email', '--state', 'draft'])).toBe(0);

        expect(h.calls[0]?.path).toBe(path);
        expect(h.out()).toContain(`${ID}  email    draft    v3  Boas-vindas (kit)`);
    });

    it('says when the library is empty and prints JSON with --json', async () => {
        const h: Harness = harness({ 'GET /v1/message-templates': { body: { items: [] } } });

        expect(await run(h.context, ['templates', 'list'])).toBe(0);
        expect(h.out()).toContain('Nenhum modelo de mensagem.');
        expect(await run(h.context, ['--json', 'templates', 'list'])).toBe(0);
        expect(JSON.parse(h.out().split('\n').slice(1).join('\n'))).toEqual({ items: [] });
    });

    it('opens a template with the format, the subject and the rules that use it', async () => {
        const h: Harness = harness({ [`GET /v1/message-templates/${ID}`]: { body: LEGACY } });

        expect(await run(h.context, ['templates', 'get', ID])).toBe(0);

        expect(h.out()).toContain('Formato: blocos, formato antigo');
        expect(h.out()).toContain('Assunto: Bem-vindo, {{contato_nome}}');
        expect(h.out()).toContain('Boas-vindas ao lead (active), envia sozinha');
    });

    it('tells a structured template from a legacy one and from plain text', async () => {
        const plain: Record<string, unknown> = { ...LEGACY, content: { subject: 'Oi', body: 'texto', footer: null, document: null } };
        const h: Harness = harness({
            [`GET /v1/message-templates/${ID}`]: { body: STRUCTURED },
            'GET /v1/message-templates/plain': { body: plain }
        });

        expect(await run(h.context, ['templates', 'get', ID])).toBe(0);
        expect(h.out()).toContain('Formato: estruturado, com a marca');
        expect(await run(h.context, ['templates', 'get', 'plain'])).toBe(0);
        expect(h.out()).toContain('Formato: texto simples');
    });

    it('fails with the API problem when the template is not found', async () => {
        const h: Harness = harness({});

        expect(await run(h.context, ['templates', 'get', ID])).not.toBe(0);
        expect(h.out()).toBe('');
    });
});

describe('nexo templates preview and structure', () => {
    it('prints the preview and saves the email HTML to a file', async () => {
        const target: string = join(directory(), 'email.html');
        const h: Harness = harness({
            [`POST /v1/message-templates/${ID}/preview`]: {
                body: {
                    previews: [
                        {
                            source: 'fixed',
                            sample: {},
                            subject: 'Olá, Acme',
                            body: '',
                            footer: null,
                            missingVariables: [],
                            missing: [],
                            email: { html: '<html>pronto</html>', text: 'texto do e-mail' }
                        }
                    ]
                }
            }
        });

        expect(await run(h.context, ['templates', 'preview', ID, '--html', target])).toBe(0);

        expect(h.out()).toContain('Assunto: Olá, Acme');
        expect(h.out()).toContain('texto do e-mail');
        expect(readFileSync(target, 'utf8')).toBe('<html>pronto</html>');
    });

    it('structures the content of a template, shows what is missing in the brand and writes nothing', async () => {
        const target: string = join(directory(), 'estruturado.json');
        const h: Harness = harness({
            [`GET /v1/message-templates/${ID}`]: { body: LEGACY },
            'POST /v1/message-templates/professional-structure': {
                body: { converted: true, content: STRUCTURED['content'], brand: STRUCTURE_BRAND_MISSING }
            }
        });

        expect(await run(h.context, ['templates', 'structure', '--template', ID, '--out', target])).toBe(0);

        expect(h.calls.map((call: Call) => `${call.method} ${call.path}`)).toEqual([
            `GET /v1/message-templates/${ID}`,
            'POST /v1/message-templates/professional-structure'
        ]);
        expect(h.calls[1]?.body).toEqual({ content: LEGACY['content'] });
        expect(h.out()).toContain('colocado na estrutura nova');
        expect(h.out()).toContain('Marca: identidade parcial, falta logo');
        expect(h.out()).toContain('Falta o logo. Cadastre em Agentes › Configurar › Identidade visual.');
        expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual(STRUCTURED['content']);
    });

    it('structures content from a file and says when there was nothing to convert', async () => {
        const file: string = join(directory(), 'conteudo.json');
        writeFileSync(file, JSON.stringify(STRUCTURED['content']));
        const h: Harness = harness({
            'POST /v1/message-templates/professional-structure': { body: { converted: false, content: STRUCTURED['content'] } }
        });

        expect(await run(h.context, ['templates', 'structure', '--input', file])).toBe(0);

        expect(h.calls[0]?.body).toEqual({ content: STRUCTURED['content'] });
        expect(h.out()).toContain('nada mudou');
    });

    it('prints a complete brand without a notice and still exits 0', async () => {
        const file: string = join(directory(), 'conteudo.json');
        writeFileSync(file, JSON.stringify(STRUCTURED['content']));
        const h: Harness = harness({
            'POST /v1/message-templates/professional-structure': {
                body: { converted: false, content: STRUCTURED['content'], brand: STRUCTURE_BRAND_COMPLETE }
            }
        });

        expect(await run(h.context, ['templates', 'structure', '--input', file])).toBe(0);

        expect(h.out()).toContain('Marca: identidade completa');
        expect(h.out()).not.toContain('falta');
    });

    it('needs exactly one source to structure', async () => {
        const h: Harness = harness({});

        expect(await run(h.context, ['templates', 'structure'])).not.toBe(0);
        expect(await run(h.context, ['templates', 'structure', '--template', ID, '--input', 'x.json'])).not.toBe(0);
        expect(h.calls).toHaveLength(0);
    });
});

describe('nexo templates create, change and publish', () => {
    it('previews first, then sends the confirmation token with the same request after the yes', async () => {
        const blocks: string = join(directory(), 'blocos.json');
        writeFileSync(blocks, JSON.stringify([{ chave: 'a', tipo: 'logo', variante: 'claro' }]));
        const h: Harness = harness({ [CHANGES_PREVIEW]: { body: CARD }, [CHANGES_APPLY]: { body: APPLIED } });

        expect(
            await run(h.context, [
                'templates',
                'create',
                '--channel',
                'email',
                '--name',
                'Boas-vindas',
                '--subject',
                'Olá, {{contato_nome}}',
                '--blocks',
                blocks,
                '--record',
                'lead',
                '--yes'
            ])
        ).toBe(0);

        const request: Record<string, unknown> = {
            acao: 'criar_modelo',
            canal: 'email',
            nome: 'Boas-vindas',
            assunto: 'Olá, {{contato_nome}}',
            registro: 'lead',
            blocos: [{ chave: 'a', tipo: 'logo', variante: 'claro' }]
        };
        expect(h.calls.map((call: Call) => `${call.method} ${call.path}`)).toEqual([CHANGES_PREVIEW, CHANGES_APPLY]);
        expect(h.calls[0]?.body).toEqual(request);
        expect(h.calls[1]?.body).toEqual({ ...request, confirmationToken: 'tok-123' });
        expect(h.out()).toContain('Criar o rascunho do modelo Boas-vindas');
        expect(h.out()).toContain('entra: cabeçalho com o logo');
        expect(h.out()).toContain('Marca: identidade parcial, falta logo');
        expect(h.out()).toContain('Rascunho criado (Boas-vindas: draft, versão 1)');
        expect(h.out()).toContain('O modelo está no formato antigo.');
    });

    it('does not write without the yes when it is not a terminal, and asks to show the card to the person', async () => {
        const h: Harness = harness({ [CHANGES_PREVIEW]: { body: CARD }, [CHANGES_APPLY]: { body: APPLIED } });

        expect(await run(h.context, ['templates', 'create', '--channel', 'email', '--name', 'Boas-vindas'])).toBe(0);

        expect(h.calls.map((call: Call) => call.path)).toEqual(['/v1/message-template-changes/preview']);
        expect(h.out()).toContain('Criar o rascunho do modelo Boas-vindas');
        expect(h.err()).toContain('rode de novo com --yes');
    });

    it('changes the draft of a template, takes the request from a file and lets the flags win', async () => {
        const input: string = join(directory(), 'pedido.json');
        writeFileSync(input, JSON.stringify({ assunto: 'velho', rodape: 'x', confirmationToken: 'solto', acao: 'criar_modelo' }));
        const h: Harness = harness({ [CHANGES_PREVIEW]: { body: CARD }, [CHANGES_APPLY]: { body: APPLIED } });

        expect(await run(h.context, ['templates', 'change', ID, '--input', input, '--subject', 'novo', '--no-structure', '-y'])).toBe(0);

        const request: Record<string, unknown> = { acao: 'mudar_modelo', modeloId: ID, assunto: 'novo', rodape: 'x', semEstrutura: true };
        expect(h.calls[0]?.body).toEqual(request);
        expect(h.calls[1]?.body).toEqual({ ...request, confirmationToken: 'tok-123' });
    });

    it('accepts the blocks from stdin, as a list or inside an object', async () => {
        const h: Harness = harness(
            { [CHANGES_PREVIEW]: { body: CARD }, [CHANGES_APPLY]: { body: APPLIED } },
            JSON.stringify({ blocos: [{ chave: 'a', tipo: 'paragrafo', texto: 'oi' }] })
        );

        expect(await run(h.context, ['templates', 'change', ID, '--blocks', '-', '--yes'])).toBe(0);

        expect(h.calls[0]?.body).toEqual({ acao: 'mudar_modelo', modeloId: ID, blocos: [{ chave: 'a', tipo: 'paragrafo', texto: 'oi' }] });
    });

    it('publishes a template with the preview and the token', async () => {
        const publishCard: Record<string, unknown> = { ...CARD, title: 'Publicar o modelo Boas-vindas' };
        const h: Harness = harness({
            [CHANGES_PREVIEW]: { body: publishCard },
            [CHANGES_APPLY]: {
                body: {
                    ok: true,
                    modelo: 'Boas-vindas',
                    situacao: 'ready',
                    versao: 3,
                    mensagem: 'Modelo publicado',
                    meta: ['em análise na Meta']
                }
            }
        });

        expect(await run(h.context, ['templates', 'publish', ID, '--yes'])).toBe(0);

        expect(h.calls[0]?.body).toEqual({ acao: 'publicar_modelo', modeloId: ID });
        expect(h.calls[1]?.body).toEqual({ acao: 'publicar_modelo', modeloId: ID, confirmationToken: 'tok-123' });
        expect(h.out()).toContain('Modelo publicado (Boas-vindas: ready, versão 3)');
        expect(h.out()).toContain('Meta: em análise na Meta');
    });

    it('shows the refusal of the composer with its reasons and writes nothing', async () => {
        const refused: unknown = {
            type: 'copilot.template_change_refused',
            title: 'CopilotTemplateChangeRefusedError',
            status: 422,
            detail: 'O Nexo não aceitou o pedido: o modelo não foi gravado',
            requestId: 'req-1',
            meta: {
                problems: ['a cor #1a2b3c foi escrita no bloco; use um nome de cor: marca, marca-escura, suave, texto, apoio ou branco']
            }
        };
        const h: Harness = harness(
            { [CHANGES_PREVIEW]: { status: 422, body: refused } },
            JSON.stringify([{ chave: 'a', tipo: 'botao', cor: '#1a2b3c' }])
        );

        expect(await run(h.context, ['templates', 'change', ID, '--blocks', '-', '--yes'])).not.toBe(0);

        expect(h.calls).toHaveLength(1);
        expect(h.out()).toBe('');
        expect(h.err()).toContain('o modelo não foi gravado');
        expect(h.err()).toContain('a cor #1a2b3c foi escrita no bloco; use um nome de cor');
    });

    it('stops with the problems of the card when the preview lists some', async () => {
        const withProblems: Record<string, unknown> = {
            ...CARD,
            change: {
                ...(CARD['change'] as Record<string, unknown>),
                problems: [{ nodeKey: 'btn', code: 'contrast', reason: 'o contraste do botão é baixo' }]
            }
        };
        const h: Harness = harness({ [CHANGES_PREVIEW]: { body: withProblems } });

        expect(await run(h.context, ['templates', 'create', '--channel', 'email', '--name', 'X', '--yes'])).not.toBe(0);

        expect(h.calls).toHaveLength(1);
        expect(h.out()).toContain('btn: o contraste do botão é baixo');
    });

    it('explains the stale confirmation and keeps the exit code of the API problem', async () => {
        const stale: unknown = {
            type: 'copilot.confirmation_stale',
            title: 'Desatualizada',
            status: 409,
            detail: 'O modelo mudou',
            requestId: null
        };
        const h: Harness = harness({ [CHANGES_PREVIEW]: { body: CARD }, [CHANGES_APPLY]: { status: 409, body: stale } });

        expect(await run(h.context, ['templates', 'create', '--channel', 'email', '--name', 'X', '--yes'])).not.toBe(0);

        expect(h.err()).toContain('rode o comando de novo e confirme');
    });

    it('refuses a blocks file that is not a list and a request that is not an object', async () => {
        const bad: string = join(directory(), 'ruim.json');
        writeFileSync(bad, '"texto"');
        const h: Harness = harness({});

        expect(await run(h.context, ['templates', 'create', '--blocks', bad])).not.toBe(0);
        expect(await run(h.context, ['templates', 'create', '--input', bad])).not.toBe(0);
        expect(h.calls).toHaveLength(0);
    });
});
