import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitPages } from '../src/docs/pages.js';
import type { DocBundle, DocPage } from '../src/docs/pages.js';

const SITE_FULL: string = 'https://docs.nexo.winningsales.com.br/llms-full.txt';
const CONNECT_FILES: Readonly<Record<string, string>> = {
    'connect/connect-sdk.d.ts': 'https://mcp-nexo.winningsales.com.br/docs/connect/connect-sdk.d.ts',
    'connect/manifest.schema.json': 'https://mcp-nexo.winningsales.com.br/docs/connect/manifest.schema.json'
};
const MINIMUM_PAGES: number = 20;

const root: string = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');

async function download(url: string): Promise<string> {
    const response: Response = await fetch(url);
    if (!response.ok) {
        throw new Error(`${url} answered ${String(response.status)}`);
    }
    return response.text();
}

function save(relative: string, content: string): void {
    const target: string = join(root, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
}

async function syncDocs(): Promise<number> {
    const pages: readonly DocPage[] = splitPages(await download(SITE_FULL));
    if (pages.length < MINIMUM_PAGES) {
        throw new Error(`only ${String(pages.length)} pages in ${SITE_FULL}; the format probably changed`);
    }
    const bundle: DocBundle = { source: SITE_FULL, fetchedAt: new Date().toISOString(), pages };
    save('docs/pages.json', `${JSON.stringify(bundle)}\n`);
    return pages.length;
}

async function syncConnect(): Promise<void> {
    for (const [relative, url] of Object.entries(CONNECT_FILES)) {
        save(relative, await download(url));
    }
}

const count: number = await syncDocs();
await syncConnect();
process.stdout.write(`${String(count)} pages and ${String(Object.keys(CONNECT_FILES).length)} Connect files synced into assets/\n`);
