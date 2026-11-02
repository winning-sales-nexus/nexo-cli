import { createInterface } from 'node:readline';
import type { Interface } from 'node:readline';
import { Writable } from 'node:stream';
import type { Readable } from 'node:stream';

export async function readAll(stream: Readable): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
    }
    return Buffer.concat(chunks).toString('utf8');
}

export async function readSecret(input: Readable, output: Writable, question: string): Promise<string> {
    output.write(question);
    const muted: Writable = new Writable({
        write(_chunk: unknown, _encoding: BufferEncoding, done: () => void): void {
            done();
        }
    });
    const reader: Interface = createInterface({ input, output: muted, terminal: true });
    try {
        return await new Promise<string>((resolve: (answer: string) => void) => {
            reader.question('', resolve);
        });
    } finally {
        reader.close();
        output.write('\n');
    }
}
