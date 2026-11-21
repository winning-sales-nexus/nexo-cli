import { describe, expect, it } from 'vitest';
import { commandTree } from '../scripts/command-tree.js';
import type { CommandEntry } from '../scripts/command-tree.js';
import { CredentialsStore } from '../src/config/credentials-store.js';
import { buildProgram } from '../src/program.js';
import { COMMAND_TOOLS, TOOL_KEYS } from '../src/tools/tool-manifest.js';
import { PassThrough, Readable } from 'node:stream';

/** Grupos que também são comandos (têm ação própria além dos subcomandos). */
const GROUPS_WITH_ACTION: readonly string[] = ['nexo documents templates'];

function invocable(entry: CommandEntry): string[] {
    const own: string[] = entry.commands.length === 0 || GROUPS_WITH_ACTION.includes(entry.path) ? [entry.path] : [];
    return [...own, ...entry.commands.flatMap(invocable)];
}

const tree: CommandEntry = commandTree(
    buildProgram({
        store: new CredentialsStore('/nonexistent'),
        env: {},
        stdin: Readable.from(['']),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        fetchFn: () => Promise.reject(new Error('offline')),
        openUrl: () => Promise.resolve(false)
    })
);

describe('COMMAND_TOOLS', () => {
    it('declares a key or a reason to have none for every invocable command', () => {
        const missing: string[] = invocable(tree).filter((path) => COMMAND_TOOLS[path] === undefined);

        expect(missing).toEqual([]);
    });

    it('has no entry for a command that no longer exists', () => {
        const paths: Set<string> = new Set(invocable(tree));

        expect(Object.keys(COMMAND_TOOLS).filter((path) => !paths.has(path))).toEqual([]);
    });

    it('covers the 79 commands and only uses known keys or a non-empty reason', () => {
        expect(Object.keys(COMMAND_TOOLS)).toHaveLength(79);
        const known: ReadonlySet<string> = new Set(TOOL_KEYS);
        for (const [path, declaration] of Object.entries(COMMAND_TOOLS)) {
            if ('none' in declaration) {
                expect(declaration.none.trim(), path).not.toBe('');
                continue;
            }
            const keys: readonly string[] = Array.isArray(declaration.key) ? declaration.key : [declaration.key];
            expect(keys.length, path).toBeGreaterThan(0);
            expect(
                keys.filter((key) => !known.has(key)),
                path
            ).toEqual([]);
        }
    });
});
