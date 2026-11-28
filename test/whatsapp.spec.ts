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

const ITEMS: unknown = {
    items: [
        {
            id: 'c1',
            displayPhoneNumber: '+55 11 90000-0001',
            verifiedName: 'Winning',
            provider: 'meta',
            official: true,
            ownerName: null,
            companyNumber: true,
            status: 'active',
            cause: null,
            canSendTemplates: true
        },
        {
            id: 'c2',
            displayPhoneNumber: '+55 11 90000-0002',
            verifiedName: null,
            provider: 'crm_inbox',
            official: false,
            ownerName: 'Rafael',
            companyNumber: false,
            status: 'invalid',
            cause: { problem: 'O token expirou.', action: 'Reconecte o número.' },
            canSendTemplates: false
        }
    ]
};

interface Harness {
    readonly context: CliContext;
    readonly paths: string[];
    readonly out: () => string;
}

function harness(body: unknown): Harness {
    const paths: string[] = [];
    const stdout: PassThrough = new PassThrough();
    let out: string = '';
    stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    const fetchFn: FetchFunction = (url: string) => {
        paths.push(url.replace(API, ''));
        return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
    };
    const context: CliContext = {
        store: new CredentialsStore(mkdtempSync(join(tmpdir(), 'nexo-whatsapp-'))),
        env: { NEXO_TOKEN: `nexo_pat_${'d'.repeat(38)}` },
        stdin: Readable.from(['']),
        stdout,
        stderr: new PassThrough(),
        fetchFn,
        openUrl: () => Promise.resolve(false)
    };
    return { context, paths, out: () => out };
}

describe('nexo whatsapp numbers', () => {
    it('lists each number with the kind, the owner, the state, the cause and whether it sends templates', async () => {
        const h: Harness = harness(ITEMS);

        expect(await run(h.context, ['whatsapp', 'numbers'])).toBe(0);

        expect(h.paths).toEqual(['/v1/whatsapp/numbers']);
        expect(h.out()).toContain('+55 11 90000-0001  oficial da Meta  dono: empresa  active  envia modelos');
        expect(h.out()).toContain('dono: Rafael  inválido  não envia modelos');
        expect(h.out()).toContain('Problema: O token expirou.');
        expect(h.out()).toContain('O que fazer: Reconecte o número.');
    });

    it('says when there is no number and prints the API answer with --json', async () => {
        const empty: Harness = harness({ items: [] });
        expect(await run(empty.context, ['whatsapp', 'numbers'])).toBe(0);
        expect(empty.out()).toContain('Nenhum número de WhatsApp conectado.');

        const h: Harness = harness(ITEMS);
        expect(await run(h.context, ['--json', 'whatsapp', 'numbers'])).toBe(0);
        expect(JSON.parse(h.out())).toEqual(ITEMS);
    });
});
