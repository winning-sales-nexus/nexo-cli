import { clientOf, printJson, printLine, sessionOf } from '../context.js';
import type { CliContext } from '../context.js';
import type { Session } from '../config/session.js';
import { CliError, usageError } from '../errors.js';
import { EXIT_CODES } from '../exit-codes.types.js';
import type { ApiResponse } from '../http/nexo-client.js';
import { requestLocalChange } from '../connect/changes.js';
import { projectDirectory, readFiles, readState, writeFiles, writeState } from '../connect/project.js';
import type { ConnectorFiles, ConnectorState } from '../connect/project.js';
import { describeVersion, isVersionDiff, isVersionFiles, isVersionList, sameFiles } from '../connect/versions.js';
import type { VersionFiles } from '../connect/versions.js';
import { fetchConnector } from './connect-files.js';
import { connectorIdOf } from './connect-runs.js';
import type { ConnectRunOptions } from './connect-runs.js';

export interface VersionOptions extends Omit<ConnectRunOptions, 'confirm'> {
    /** Em `restore` a confirmação é local (sem token). */
    readonly confirm?: boolean;
    readonly force?: boolean;
}

function base(connectorId: string): string {
    return `/v1/connect/connectors/${connectorId}`;
}

function seqOf(raw: string): number {
    const seq: number = Number(raw);
    if (!Number.isInteger(seq) || seq < 1) {
        throw usageError(`"${raw}" não é um número de versão.`, 'Veja as versões com `nexo connect versions`.');
    }
    return seq;
}

async function fetchVersion(context: CliContext, session: Session, connectorId: string, seq: number): Promise<VersionFiles> {
    const response: ApiResponse = await clientOf(context, session).request({
        method: 'GET',
        path: `${base(connectorId)}/versions/${String(seq)}`
    });
    if (!isVersionFiles(response.body)) {
        throw new Error('Versão em formato inesperado.');
    }
    return response.body;
}

export async function connectVersions(context: CliContext, dir: string | undefined, options: VersionOptions): Promise<void> {
    const connectorId: string = connectorIdOf(options, dir);
    const session: Session = sessionOf(context, options);
    const response: ApiResponse = await clientOf(context, session).request({ method: 'GET', path: `${base(connectorId)}/versions` });
    if (!isVersionList(response.body)) {
        throw new Error('Lista de versões em formato inesperado.');
    }
    if (options.json === true) {
        printJson(context, response.body);
        return;
    }
    const view = (await fetchConnector(context, session, connectorId)).connector;
    for (const version of response.body) {
        printLine(context, describeVersion(version, { head: view.headSeq, published: view.publishedSeq }));
    }
}

/** `diff <de> [para] [pasta]`: o segundo argumento que não é número é a pasta. */
function diffArguments(
    from: string,
    second: string | undefined,
    third: string | undefined
): { from: number; to: number | null; dir: string | undefined } {
    if (second !== undefined && !/^\d+$/.test(second) && third === undefined) {
        return { from: seqOf(from), to: null, dir: second };
    }
    return { from: seqOf(from), to: second === undefined ? null : seqOf(second), dir: third };
}

export async function connectDiff(
    context: CliContext,
    from: string,
    second: string | undefined,
    third: string | undefined,
    options: VersionOptions
): Promise<void> {
    const wanted = diffArguments(from, second, third);
    const connectorId: string = connectorIdOf(options, wanted.dir);
    const session: Session = sessionOf(context, options);
    const to: number = wanted.to ?? (await fetchConnector(context, session, connectorId)).connector.headSeq;
    const response: ApiResponse = await clientOf(context, session).request({
        method: 'GET',
        path: `${base(connectorId)}/versions/${String(to)}/diff?against=${String(wanted.from)}`
    });
    if (options.json === true) {
        printJson(context, response.body);
        return;
    }
    if (!isVersionDiff(response.body)) {
        throw new Error('Comparação em formato inesperado.');
    }
    if (response.body.same) {
        printLine(context, `A versão ${String(wanted.from)} e a ${String(to)} têm o mesmo código e o mesmo manifesto.`);
        return;
    }
    printLine(context, `Da versão ${String(wanted.from)} para a ${String(to)}:`);
    if (response.body.code !== '') {
        printLine(context, `--- código\n${response.body.code.trimEnd()}`);
    }
    if (response.body.manifest !== '') {
        printLine(context, `--- manifesto\n${response.body.manifest.trimEnd()}`);
    }
}

async function assertFolderUnchanged(
    context: CliContext,
    session: Session,
    connectorId: string,
    directory: string,
    state: ConnectorState
): Promise<void> {
    const local: ConnectorFiles = readFiles(directory);
    const origin: VersionFiles | null = state.baseSeq === null ? null : await fetchVersion(context, session, connectorId, state.baseSeq);
    if (origin === null || !sameFiles(local, origin)) {
        throw new CliError(
            'A pasta tem mudanças que não foram para o Nexo; restaurar as apagaria.',
            EXIT_CODES.failure,
            'Suba com `nexo connect push -m "..."`, ou use --force para descartá-las.'
        );
    }
}

export async function connectRestore(
    context: CliContext,
    seqText: string,
    dir: string | undefined,
    options: VersionOptions
): Promise<void> {
    const seq: number = seqOf(seqText);
    const directory: string = projectDirectory(dir);
    const state: ConnectorState = readState(directory);
    const connectorId: string = connectorIdOf(options, dir);
    const session: Session = sessionOf(context, options);
    const target: VersionFiles = await fetchVersion(context, session, connectorId, seq);
    if (options.force !== true) {
        await assertFolderUnchanged(context, session, connectorId, directory, state);
    }
    await requestLocalChange(context, {
        preview: {
            title: `Voltar à versão ${String(seq)}${target.summary === null ? '' : `: ${target.summary}`}`,
            changes: [
                `Escrita em ${target.createdAt.slice(0, 16).replace('T', ' ')} (${target.origin}).`,
                'O Nexo guarda isto como uma versão nova, em edição; o que está publicado não muda.',
                'connector.ts e manifest.json desta pasta são reescritos com ela.'
            ]
        },
        command: `nexo connect restore ${String(seq)}`,
        confirmed: options.confirm === true,
        yes: options.yes === true,
        json: options.json === true,
        apply: async () => {
            const response: ApiResponse = await clientOf(context, session).request({
                method: 'POST',
                path: `${base(connectorId)}/versions/${String(seq)}/restore`
            });
            const created: number = (response.body as { seq?: number }).seq ?? seq;
            writeFiles(directory, { code: target.code, manifest: target.manifest });
            writeState(directory, { ...state, connectorId, baseSeq: created });
            return response;
        },
        report: (body: unknown) => {
            const created: number | undefined = (body as { seq?: number }).seq;
            printLine(
                context,
                `A versão ${String(seq)} voltou como a versão ${String(created ?? '?')}, em edição. Ensaie com \`nexo connect rehearse\` e publique.`
            );
        }
    });
}
