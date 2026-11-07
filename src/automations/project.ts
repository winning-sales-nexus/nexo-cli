import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { usageError } from '../errors.js';

export const AUTOMATION_FILE: string = 'automation.json';
export const AUTOMATION_STATE_FILE: string = 'nexo-automation.json';

export interface AutomationSettings {
    readonly name: string;
    readonly description: string | null;
    readonly reentryMode: 'every_event' | 'once_per_subject' | 'cooldown';
    readonly reentryMinutes: number | null;
    readonly reactsToAutomations: boolean;
    readonly document: Record<string, unknown>;
}

export interface AutomationState {
    readonly flowId: string | null;
}

function readJson(path: string): unknown {
    try {
        return JSON.parse(readFileSync(path, 'utf8')) as unknown;
    } catch {
        throw usageError(`${path} não é JSON válido.`);
    }
}

function isSettings(value: unknown): value is AutomationSettings {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const fields: Partial<Record<keyof AutomationSettings, unknown>> = value;
    return typeof fields.name === 'string' && typeof fields.document === 'object' && fields.document !== null;
}

export function readAutomation(directory: string): AutomationSettings {
    const path: string = join(directory, AUTOMATION_FILE);
    if (!existsSync(path)) {
        throw usageError(
            `Não há ${AUTOMATION_FILE} em ${directory}.`,
            'Crie com `nexo automations init <pasta>` ou baixe com `nexo automations pull <id>`.'
        );
    }
    const settings: unknown = readJson(path);
    if (!isSettings(settings)) {
        throw usageError(`${AUTOMATION_FILE} precisa de "name" e "document".`);
    }
    return settings;
}

export function writeAutomation(directory: string, settings: AutomationSettings): void {
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, AUTOMATION_FILE), `${JSON.stringify(settings, null, 2)}\n`);
}

export function readAutomationState(directory: string): AutomationState {
    const path: string = join(directory, AUTOMATION_STATE_FILE);
    if (!existsSync(path)) {
        return { flowId: null };
    }
    const state: unknown = readJson(path);
    const flowId: unknown = typeof state === 'object' && state !== null ? (state as { flowId?: unknown }).flowId : null;
    return { flowId: typeof flowId === 'string' ? flowId : null };
}

export function writeAutomationState(directory: string, state: AutomationState): void {
    writeFileSync(join(directory, AUTOMATION_STATE_FILE), `${JSON.stringify(state, null, 2)}\n`);
}

export function templateAutomation(name: string): AutomationSettings {
    return {
        name,
        description: null,
        reentryMode: 'every_event',
        reentryMinutes: null,
        reactsToAutomations: false,
        document: {
            schema: 1,
            name,
            nodes: [
                { key: 'inicio', type: 'trigger', kind: 'KIND_DO_GATILHO', config: {} },
                { key: 'acao', type: 'action', kind: 'KIND_DA_ACAO', config: {}, onFailure: 'stop' },
                { key: 'fim', type: 'end', config: { outcome: 'done' } }
            ],
            edges: [
                { from: 'inicio', to: 'acao' },
                { from: 'acao', to: 'fim' }
            ]
        }
    };
}
