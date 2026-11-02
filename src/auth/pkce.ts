import { createHash, randomBytes } from 'node:crypto';

export interface PkcePair {
    readonly verifier: string;
    readonly challenge: string;
}

export function randomToken(bytes: number = 32): string {
    return randomBytes(bytes).toString('base64url');
}

export function pkcePair(): PkcePair {
    const verifier: string = randomToken(48);
    return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}
