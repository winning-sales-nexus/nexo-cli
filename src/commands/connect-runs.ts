import { clientOf, printJson, printLine, sessionOf } from '../context.js';
import type { CliContext, GlobalOptions } from '../context.js';
import type { Session } from '../config/session.js';
import { CliError, usageError } from '../errors.js';
import { EXIT_CODES } from '../exit-codes.types.js';
import type { ApiResponse } from '../http/nexo-client.js';
import { readAll, readSecret } from '../input/read-input.js';
import { requestChange } from '../connect/changes.js';
import type { ChangeKind } from '../connect/changes.types.js';
import { projectDirectory, readState } from '../connect/project.js';
import type { ConnectorState } from '../connect/project.js';
import { DEFAULT_WAIT, fetchRun, printRun, runIsClean, waitForRun } from '../connect/runs.js';
import type { Run, WaitOptions } from '../connect/runs.js';

export interface ConnectRunOptions extends GlobalOptions {
    readonly connector?: string;
    readonly full?: boolean;
    readonly wait?: boolean;
    readonly confirm?: string;
    readonly yes?: boolean;
    readonly stdin?: boolean;
    readonly category?: string;
}

interface Rehearsal {
    readonly runId: string;
    readonly link: string;
}

export function connectorIdOf(options: ConnectRunOptions, dir: string | undefined): string {
    if (options.connector !== undefined) {
        return options.connector;
    }
    const state: ConnectorState = readState(projectDirectory(dir));
    if (state.connectorId === null) {
        throw usageError('Este conector ainda não foi enviado ao Nexo.', 'Suba com `nexo connect push -m "primeira versão"`.');
    }
    return state.connectorId;
}

function reportRehearsal(context: CliContext, run: Run, rehearsal: Rehearsal, json: boolean): void {
    if (json) {
        printJson(context, run);
        return;
    }
    printRun(context, run);
    printLine(context, `Tela: ${rehearsal.link}`);
}

export async function connectRehearse(
    context: CliContext,
    dir: string | undefined,
    options: ConnectRunOptions,
    wait: WaitOptions = DEFAULT_WAIT
): Promise<void> {
    const connectorId: string = connectorIdOf(options, dir);
    const session: Session = sessionOf(context, options);
    const response: ApiResponse = await clientOf(context, session).request({
        method: 'POST',
        path: `/v1/connect/connectors/${connectorId}/rehearsals`,
        body: { scope: options.full === true ? 'full' : 'sample' }
    });
    const rehearsal: Rehearsal = response.body as Rehearsal;
    if (options.wait === false) {
        printLine(context, `Ensaio ${rehearsal.runId} começou: ${rehearsal.link}`);
        return;
    }
    const run: Run = await waitForRun(context, session, { connectorId, runId: rehearsal.runId }, wait);
    reportRehearsal(context, run, rehearsal, options.json === true);
    if (!runIsClean(run)) {
        throw new CliError(
            'O ensaio não passou limpo.',
            EXIT_CODES.failure,
            'Leia o erro acima, corrija, suba outra versão e ensaie de novo.'
        );
    }
}

export async function connectRun(context: CliContext, runId: string, dir: string | undefined, options: ConnectRunOptions): Promise<void> {
    const run: Run = await fetchRun(context, sessionOf(context, options), connectorIdOf(options, dir), runId);
    if (options.json === true) {
        printJson(context, run);
        return;
    }
    printRun(context, run);
}

export async function connectRuns(context: CliContext, dir: string | undefined, options: ConnectRunOptions): Promise<void> {
    const connectorId: string = connectorIdOf(options, dir);
    const response: ApiResponse = await clientOf(context, sessionOf(context, options)).request({
        method: 'GET',
        path: `/v1/connect/connectors/${connectorId}/runs`
    });
    const runs: readonly Run[] = (response.body as { runs?: Run[] }).runs ?? [];
    if (options.json === true) {
        printJson(context, response.body);
        return;
    }
    for (const run of runs) {
        const started: string = (run as Run & { startedAt?: string }).startedAt ?? '';
        printLine(context, `${run.id}  ${run.status.padEnd(9)} ${run.mode === 'dry_run' ? 'ensaio' : 'ao vivo'}  ${started}`);
    }
}

export async function connectChange(
    context: CliContext,
    kind: ChangeKind,
    dir: string | undefined,
    options: ConnectRunOptions
): Promise<void> {
    await requestChange(context, sessionOf(context, options), {
        connectorId: connectorIdOf(options, dir),
        kind,
        confirm: options.confirm,
        yes: options.yes === true,
        json: options.json === true
    });
}

async function secretValue(context: CliContext, name: string, options: ConnectRunOptions): Promise<string> {
    if (options.stdin === true) {
        return (await readAll(context.stdin)).replace(/\r?\n$/, '');
    }
    if (context.stdin.isTTY !== true) {
        throw usageError(
            'O valor de um segredo só é digitado por uma pessoa, num terminal.',
            'Rode o comando você mesmo; num script, use --stdin.'
        );
    }
    return readSecret(context.stdin, context.stderr, `Valor de ${name} (não aparece na tela): `);
}

export async function connectSecretSet(
    context: CliContext,
    name: string,
    dir: string | undefined,
    options: ConnectRunOptions
): Promise<void> {
    const connectorId: string = connectorIdOf(options, dir);
    const value: string = await secretValue(context, name, options);
    if (value === '') {
        throw usageError('O valor veio vazio; nada foi salvo.');
    }
    await clientOf(context, sessionOf(context, options)).request({
        method: 'PUT',
        path: `/v1/connect/connectors/${connectorId}/secrets/${encodeURIComponent(name)}`,
        body: { value }
    });
    printLine(context, `Segredo ${name} salvo. O valor não volta pela API.`);
}

export async function connectSystems(context: CliContext, options: ConnectRunOptions): Promise<void> {
    const response: ApiResponse = await clientOf(context, sessionOf(context, options)).request({
        method: 'GET',
        path: '/v1/connect/systems'
    });
    const rows: readonly { slug: string; name: string; category: string; runsOn: string }[] = Array.isArray(response.body)
        ? response.body
        : [];
    const shown: readonly { slug: string; name: string; category: string; runsOn: string }[] =
        options.category === undefined ? rows : rows.filter((row) => row.category === options.category);
    if (options.json === true) {
        printJson(context, shown);
        return;
    }
    for (const row of shown) {
        printLine(context, `${row.slug.padEnd(22)} ${row.name.padEnd(28)} ${row.category.padEnd(10)} ${row.runsOn}`);
    }
}

export async function connectList(context: CliContext, options: ConnectRunOptions): Promise<void> {
    const response: ApiResponse = await clientOf(context, sessionOf(context, options)).request({
        method: 'GET',
        path: '/v1/connect/connectors'
    });
    const rows: readonly { id: string; name: string; status: string; headSeq: number; publishedSeq: number | null }[] = Array.isArray(
        response.body
    )
        ? response.body
        : [];
    if (options.json === true) {
        printJson(context, rows);
        return;
    }
    for (const row of rows) {
        printLine(
            context,
            `${row.id}  ${row.status.padEnd(8)} v${String(row.headSeq)} (publicada ${row.publishedSeq === null ? '-' : String(row.publishedSeq)})  ${row.name}`
        );
    }
}
