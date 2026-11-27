import { clientOf, printJson, printLine, sessionOf } from '../context.js';
import type { CliContext } from '../context.js';
import { requestChange, requestLocalChange } from '../connect/changes.js';
import { usageError } from '../errors.js';
import type { ApiResponse } from '../http/nexo-client.js';
import { readFixFile, describeItem, describeWrites, fixFrom, fixPreview, isExternalWrites, isQuarantineList } from '../connect/retained.js';
import type { ExternalWrites, QuarantineFix, QuarantineItem } from '../connect/retained.js';
import { connectorIdOf } from './connect-runs.js';
import type { ConnectRunOptions } from './connect-runs.js';

export interface RetainedOptions extends Omit<ConnectRunOptions, 'confirm'> {
    readonly set?: readonly string[];
    readonly file?: string;
    /** Em `fix` e `discard` a confirmação é local (sem token); nos outros é o token da prévia. */
    readonly confirm?: string | boolean;
}

function base(connectorId: string): string {
    return `/v1/connect/connectors/${connectorId}`;
}

function tokenOf(options: RetainedOptions): string | undefined {
    return typeof options.confirm === 'string' ? options.confirm : undefined;
}

async function openItems(context: CliContext, options: RetainedOptions, dir: string | undefined): Promise<readonly QuarantineItem[]> {
    const response: ApiResponse = await clientOf(context, sessionOf(context, options)).request({
        method: 'GET',
        path: `${base(connectorIdOf(options, dir))}/quarantine`
    });
    if (!isQuarantineList(response.body)) {
        throw new Error('Quarentena em formato inesperado.');
    }
    return response.body;
}

export async function quarantineList(context: CliContext, dir: string | undefined, options: RetainedOptions): Promise<void> {
    const items: readonly QuarantineItem[] = await openItems(context, options, dir);
    if (options.json === true) {
        printJson(context, items);
        return;
    }
    if (items.length === 0) {
        printLine(context, 'Nenhum registro aberto na quarentena.');
        return;
    }
    for (const line of items.flatMap(describeItem)) {
        printLine(context, line);
    }
}

async function itemOf(context: CliContext, itemId: string, dir: string | undefined, options: RetainedOptions): Promise<QuarantineItem> {
    const item: QuarantineItem | undefined = (await openItems(context, options, dir)).find((found: QuarantineItem) => found.id === itemId);
    if (item === undefined) {
        throw usageError(`O registro ${itemId} não está aberto na quarentena.`, 'Veja os abertos com `nexo connect quarantine`.');
    }
    return item;
}

export async function quarantineFix(context: CliContext, itemId: string, dir: string | undefined, options: RetainedOptions): Promise<void> {
    const fix: QuarantineFix = fixFrom(options.set ?? [], options.file === undefined ? null : readFixFile(options.file));
    const item: QuarantineItem = await itemOf(context, itemId, dir, options);
    const connectorId: string = connectorIdOf(options, dir);
    await requestLocalChange(context, {
        preview: fixPreview(item, fix),
        command: `nexo connect quarantine fix ${itemId}`,
        confirmed: options.confirm === true,
        yes: options.yes === true,
        json: options.json === true,
        apply: () =>
            clientOf(context, sessionOf(context, options)).request({
                method: 'PATCH',
                path: `${base(connectorId)}/quarantine/${encodeURIComponent(itemId)}`,
                body: fix
            })
    });
}

export async function quarantineDiscard(
    context: CliContext,
    itemId: string,
    dir: string | undefined,
    options: RetainedOptions
): Promise<void> {
    const item: QuarantineItem = await itemOf(context, itemId, dir, options);
    const connectorId: string = connectorIdOf(options, dir);
    await requestLocalChange(context, {
        preview: {
            title: `Descartar o registro ${item.id} (${item.objectType}) da quarentena`,
            changes: [...describeItem(item).slice(1), 'Ele sai da quarentena sem ir para o Nexo.']
        },
        command: `nexo connect quarantine discard ${itemId}`,
        confirmed: options.confirm === true,
        yes: options.yes === true,
        json: options.json === true,
        apply: () =>
            clientOf(context, sessionOf(context, options)).request({
                method: 'POST',
                path: `${base(connectorId)}/quarantine/${encodeURIComponent(itemId)}/discard`
            })
    });
}

function reprocessSummary(body: unknown): readonly string[] {
    const result: { resolved?: number; refused?: number; left?: number; status?: string } = body as {
        resolved?: number;
        refused?: number;
        left?: number;
        status?: string;
    };
    return [
        `Resolvidos: ${String(result.resolved ?? 0)}, recusados de novo: ${String(result.refused ?? 0)}, para o próximo: ${String(result.left ?? 0)}.`,
        ...(result.status === 'running' ? ['A execução continua; veja `nexo connect runs`.'] : [])
    ];
}

export async function quarantineReprocess(context: CliContext, dir: string | undefined, options: RetainedOptions): Promise<void> {
    await requestChange(context, sessionOf(context, options), {
        connectorId: connectorIdOf(options, dir),
        path: 'quarantine/reprocess',
        command: 'nexo connect quarantine reprocess',
        summarize: reprocessSummary,
        confirm: tokenOf(options),
        yes: options.yes === true,
        json: options.json === true
    });
}

export async function writesList(context: CliContext, dir: string | undefined, options: RetainedOptions): Promise<void> {
    const response: ApiResponse = await clientOf(context, sessionOf(context, options)).request({
        method: 'GET',
        path: `${base(connectorIdOf(options, dir))}/external-writes`
    });
    if (!isExternalWrites(response.body)) {
        throw new Error('Escritas retidas em formato inesperado.');
    }
    if (options.json === true) {
        printJson(context, response.body);
        return;
    }
    const writes: ExternalWrites = response.body;
    for (const line of describeWrites(writes)) {
        printLine(context, line);
    }
}

export async function writesConfirm(context: CliContext, id: string, dir: string | undefined, options: RetainedOptions): Promise<void> {
    await requestChange(context, sessionOf(context, options), {
        connectorId: connectorIdOf(options, dir),
        path: `external-writes/${encodeURIComponent(id)}/confirm`,
        command: `nexo connect writes confirm ${id}`,
        confirm: tokenOf(options),
        yes: options.yes === true,
        json: options.json === true
    });
}

export async function writeHost(
    context: CliContext,
    action: 'confirm' | 'revoke',
    host: string,
    dir: string | undefined,
    options: RetainedOptions
): Promise<void> {
    await requestChange(context, sessionOf(context, options), {
        connectorId: connectorIdOf(options, dir),
        path: `write-hosts/${action}`,
        body: { host },
        command: `nexo connect write-hosts ${action} ${host}`,
        confirm: tokenOf(options),
        yes: options.yes === true,
        json: options.json === true
    });
}
