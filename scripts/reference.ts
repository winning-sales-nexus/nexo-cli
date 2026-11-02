import { writeFileSync } from 'node:fs';
import { cliReference } from './command-tree.js';

function outPath(argv: readonly string[]): string | null {
    const index: number = argv.indexOf('--out');
    return index === -1 ? null : (argv[index + 1] ?? null);
}

const target: string | null = outPath(process.argv.slice(2));
const json: string = `${JSON.stringify(cliReference(), null, 2)}\n`;
function write(path: string | null, content: string): void {
    if (path === null) {
        process.stdout.write(content);
        return;
    }
    writeFileSync(path, content);
}

write(target, json);
