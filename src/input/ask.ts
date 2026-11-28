import { createInterface } from 'node:readline';
import type { Interface } from 'node:readline';
import type { CliContext } from '../context.js';

export function isInteractive(context: CliContext): boolean {
    return context.stdin.isTTY === true;
}

export async function ask(context: CliContext, question: string): Promise<string> {
    const reader: Interface = createInterface({ input: context.stdin, output: context.stderr, terminal: true });
    try {
        const answer: string = await new Promise<string>((resolve: (text: string) => void) => {
            reader.question(question, resolve);
        });
        return answer.trim();
    } finally {
        reader.close();
    }
}
