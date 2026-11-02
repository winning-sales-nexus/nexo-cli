import { describe, expect, it } from 'vitest';
import { cliReference } from '../scripts/command-tree.js';
import type { CliReference, CommandEntry } from '../scripts/command-tree.js';

function find(entry: CommandEntry, path: string): CommandEntry | undefined {
    if (entry.path === path) {
        return entry;
    }
    return entry.commands.map((child) => find(child, path)).find((found) => found !== undefined);
}

describe('cliReference', () => {
    it('lists every command with its arguments, options, defaults and choices, without the help command', () => {
        const reference: CliReference = cliReference();

        expect(reference.program.name).toBe('nexo');
        expect(reference.version).toMatch(/^\d+\.\d+\.\d+/);
        expect(reference.program.commands.map((command) => command.name)).toContain('login');
        expect(reference.program.commands.map((command) => command.name)).not.toContain('help');
        const login: CommandEntry | undefined = find(reference.program, 'nexo login');
        expect(login?.options.find((option) => option.flags === '--env <ambiente>')).toMatchObject({
            default: 'prod',
            choices: ['prod', 'dev']
        });
        const push: CommandEntry | undefined = find(reference.program, 'nexo connect push');
        expect(push?.arguments[0]).toMatchObject({ name: 'pasta', required: false, default: '.' });
        expect(push?.options.find((option) => option.flags === '-m, --summary <texto>')?.required).toBe(true);
    });
});
