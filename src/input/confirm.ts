import { createInterface } from 'node:readline';
import type { Interface } from 'node:readline';
import { printNotice } from '../context.js';
import type { CliContext } from '../context.js';

/** O "sim" da pessoa antes de uma escrita: --yes passa direto; sem terminal, devolve false e avisa. */
export async function confirmed(context: CliContext, yes: boolean | undefined): Promise<boolean> {
    if (yes === true) {
        return true;
    }
    if (context.stdin.isTTY !== true) {
        printNotice(context, 'Mostre isto à pessoa. Depois do sim dela, rode de novo com --yes.');
        return false;
    }
    const reader: Interface = createInterface({ input: context.stdin, output: context.stderr, terminal: true });
    try {
        const answer: string = await new Promise<string>((resolve: (text: string) => void) => {
            reader.question('Continuar? (s/N) ', resolve);
        });
        return /^(s|sim|y|yes)$/i.test(answer.trim());
    } finally {
        reader.close();
    }
}
