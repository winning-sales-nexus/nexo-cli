import { existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { currentSession, profileName } from '../config/session.js';
import type { Session } from '../config/session.js';
import { clientOf, printJson, printLine, printNotice } from '../context.js';
import type { CliContext, GlobalOptions } from '../context.js';
import { CliError, usageError } from '../errors.js';
import type { NexoClient } from '../http/nexo-client.js';
import { NexoApiError } from '../http/problem.js';
import { LEVEL_LABELS, SKILL_KIND, clientLevelOnly, contextUnits, remoteIndex, remoteSkill } from '../skills/remote-skills.js';
import type { RemoteSkill, RemoteSkillEntry } from '../skills/remote-skills.js';
import { staleBundledSkills, staleNotice } from '../skills/bundled-freshness.js';
import { bundledSkills } from '../skills/skill-files.js';
import type { Skill } from '../skills/skill-files.js';
import { SKILL_TARGETS } from '../skills/skill-targets.types.js';
import type { SkillTarget } from '../skills/skill-targets.types.js';
import { detectedTargets, installSkills } from '../skills/targets.js';
import { homeOf, installedUserTools, syncUserSkills, userToolsFor } from '../skills/user-skills.js';
import type { UserSkillsSync, UserTool } from '../skills/user-skills.js';

export interface SkillsOptions extends GlobalOptions {
    readonly dir?: string;
    readonly claude?: boolean;
    readonly cursor?: boolean;
    readonly agents?: boolean;
    readonly all?: boolean;
}

function chosenTargets(options: SkillsOptions, directory: string): readonly SkillTarget[] {
    if (options.all === true) {
        return SKILL_TARGETS;
    }
    const chosen: readonly SkillTarget[] = SKILL_TARGETS.filter((target: SkillTarget) => options[target] === true);
    if (chosen.length > 0) {
        return chosen;
    }
    const detected: readonly SkillTarget[] = detectedTargets(directory);
    if (detected.length === 0) {
        throw usageError(
            'Não achei Claude Code, Cursor nem AGENTS.md neste projeto.',
            'Escolha: --claude, --cursor, --agents (Codex e outros) ou --all.'
        );
    }
    return detected;
}

function reasonOf(error: unknown): string {
    if (error instanceof NexoApiError || error instanceof CliError || error instanceof Error) {
        return error.message;
    }
    return String(error);
}

type RemoteState =
    | { readonly kind: 'logged-out' }
    | { readonly kind: 'failed'; readonly reason: string }
    | { readonly kind: 'ok'; readonly session: Session; readonly entries: readonly RemoteSkillEntry[] };

/** The skills of the four levels, read with the token at the time of use; with no token or no network the CLI says why and goes on. */
async function remoteState(context: CliContext, options: GlobalOptions): Promise<RemoteState> {
    const session: Session | null = currentSession(context.store, profileName(options.profile, context.env), context.env);
    if (session === null) {
        return { kind: 'logged-out' };
    }
    try {
        return { kind: 'ok', session, entries: await remoteIndex(clientOf(context, session)) };
    } catch (error: unknown) {
        return { kind: 'failed', reason: reasonOf(error) };
    }
}

/** With network, compares the skills that came with the CLI against the ones the Nexo serves, and warns when they are old. */
async function staleSkillsNotice(context: CliContext): Promise<void> {
    const stale: readonly string[] | null = await staleBundledSkills(context.fetchFn);
    if (stale !== null && stale.length > 0) {
        printNotice(context, staleNotice(stale));
    }
}

function remoteNotice(context: CliContext, state: RemoteState): void {
    if (state.kind === 'logged-out') {
        printNotice(
            context,
            'Sem login: só as skills de produto, que vêm com a CLI. Rode `nexo login` para ter também as da sua empresa, área e time.'
        );
    }
    if (state.kind === 'failed') {
        printNotice(context, `Não consegui ler as skills da empresa (${state.reason}). Ficam as de produto, que vêm com a CLI.`);
    }
}

type OkState = Extract<RemoteState, { readonly kind: 'ok' }>;

interface ClientInstall {
    readonly tools: readonly UserTool[];
    readonly skills: readonly string[];
    readonly units: readonly string[];
    readonly sync: UserSkillsSync;
}

async function syncedClient(context: CliContext, state: OkState, targets: readonly SkillTarget[]): Promise<ClientInstall> {
    const client: NexoClient = clientOf(context, state.session);
    const entries: readonly RemoteSkillEntry[] = clientLevelOnly(state.entries);
    const units: readonly RemoteSkillEntry[] = contextUnits(state.entries);
    const home: string = homeOf(context.env);
    const tools: readonly UserTool[] = userToolsFor(home, targets);
    const load = (entry: RemoteSkillEntry): Promise<RemoteSkill> => remoteSkill(client, entry.name);
    const sync: UserSkillsSync = await syncUserSkills(home, tools, state.session.profile, entries, load, new Date(), units);
    return {
        tools,
        skills: entries.map((entry: RemoteSkillEntry) => entry.name),
        units: units.map((unit: RemoteSkillEntry) => unit.name),
        sync
    };
}

async function installClientSkills(
    context: CliContext,
    state: RemoteState,
    targets: readonly SkillTarget[]
): Promise<ClientInstall | null> {
    if (state.kind !== 'ok') {
        return null;
    }
    try {
        return await syncedClient(context, state, targets);
    } catch (error: unknown) {
        printNotice(
            context,
            `Não consegui baixar as skills da empresa (${reasonOf(error)}); as que já estavam na sua pasta ficaram como estavam.`
        );
        return null;
    }
}

function clientSummary(client: ClientInstall): string {
    const { written, upToDate, removed } = client.sync;
    const parts: readonly string[] = [
        `${String(client.skills.length - upToDate.length)} novas ou atualizadas`,
        `${String(upToDate.length)} já em dia`,
        `${String(removed.length)} removidas`
    ];
    const index: string =
        client.units.length === 0
            ? ''
            : ` Mais um índice com a descrição de ${String(client.units.length)} unidades de contexto do Cérebro (o texto delas não é gravado: a sua IA abre com \`nexo skills show <id>\`).`;
    return `${String(client.skills.length)} skills da sua empresa, área e time na sua pasta (${client.tools.join(', ')}), fora do projeto: ${parts.join(', ')}.${index}${written.length === 0 && removed.length === 0 ? ' Nada mudou desde o último install.' : ''}`;
}

function clientJson(client: ClientInstall | null): Readonly<Record<string, readonly string[]>> {
    return {
        clientSkills: client === null ? [] : client.skills,
        contextUnits: client === null ? [] : client.units,
        clientTools: client === null ? [] : client.tools,
        clientFiles: client === null ? [] : client.sync.written,
        clientUpToDate: client === null ? [] : client.sync.upToDate,
        clientRemoved: client === null ? [] : client.sync.removed
    };
}

export async function skillsInstall(context: CliContext, options: SkillsOptions): Promise<void> {
    const directory: string = resolve(options.dir ?? '.');
    const skills: readonly Skill[] = bundledSkills();
    const targets: readonly SkillTarget[] = chosenTargets(options, directory);
    const written: readonly string[] = targets.flatMap((target: SkillTarget) => installSkills(directory, target, skills));
    const state: RemoteState = await remoteState(context, options);
    const client: ClientInstall | null = await installClientSkills(context, state, targets);
    if (options.json === true) {
        printJson(context, {
            directory,
            targets,
            skills: skills.map((skill: Skill) => skill.name),
            files: written,
            ...clientJson(client)
        });
        return;
    }
    for (const file of written) {
        printLine(context, `  ${relative(directory, file)}`);
    }
    printLine(context, `${String(skills.length)} skills do Nexo em ${targets.join(', ')}. Rode de novo depois de atualizar a CLI.`);
    if (client !== null) {
        printLine(context, clientSummary(client));
    }
    remoteNotice(context, state);
    await staleSkillsNotice(context);
}

function installedIn(directory: string, skill: Skill): readonly SkillTarget[] {
    const paths: Readonly<Record<SkillTarget, string>> = {
        claude: join(directory, '.claude', 'skills', skill.name, 'SKILL.md'),
        cursor: join(directory, '.cursor', 'skills', skill.name, 'SKILL.md'),
        agents: join(directory, '.nexo', 'skills', `${skill.name}.md`)
    };
    return SKILL_TARGETS.filter((target: SkillTarget) => existsSync(paths[target]));
}

interface ListRow {
    readonly name: string;
    readonly kind: string;
    readonly title: string;
    readonly level: string;
    readonly description: string;
    readonly installed: readonly string[];
}

function productRows(directory: string): readonly ListRow[] {
    return bundledSkills().map((skill: Skill) => ({
        name: skill.name,
        kind: SKILL_KIND,
        title: skill.name,
        level: LEVEL_LABELS.product,
        description: skill.description,
        installed: installedIn(directory, skill)
    }));
}

function clientRows(context: CliContext, state: RemoteState): readonly ListRow[] {
    if (state.kind !== 'ok') {
        return [];
    }
    const home: string = homeOf(context.env);
    const units: readonly RemoteSkillEntry[] = contextUnits(state.entries);
    const unitRows: readonly ListRow[] = units.map((entry: RemoteSkillEntry) => ({
        name: entry.name,
        kind: entry.kind,
        title: entry.title,
        level: entry.status === 'tentative' ? `${LEVEL_LABELS[entry.level]}, em teste` : LEVEL_LABELS[entry.level],
        description: entry.description,
        installed: []
    }));
    const skillRows: readonly ListRow[] = clientLevelOnly(state.entries).map((entry: RemoteSkillEntry) => ({
        name: entry.name,
        kind: entry.kind,
        title: entry.title,
        level: entry.status === 'tentative' ? `${LEVEL_LABELS[entry.level]}, em teste` : LEVEL_LABELS[entry.level],
        description: entry.description,
        installed: installedUserTools(home, state.session.profile, entry)
    }));
    return [...unitRows, ...skillRows];
}

export async function skillsList(context: CliContext, options: SkillsOptions): Promise<void> {
    const directory: string = resolve(options.dir ?? '.');
    const state: RemoteState = await remoteState(context, options);
    const rows: readonly ListRow[] = [...productRows(directory), ...clientRows(context, state)];
    if (options.json === true) {
        printJson(context, rows);
        return;
    }
    for (const row of rows) {
        if (row.kind !== SKILL_KIND) {
            printLine(context, `${row.name} [contexto: ${row.kind}, ${row.level}] ${row.title}\n    ${row.description}`);
            continue;
        }
        const where: string = row.installed.length === 0 ? 'não instalada aqui' : `instalada: ${row.installed.join(', ')}`;
        printLine(context, `${row.name} [${row.level}] (${where})\n    ${row.description}`);
    }
    remoteNotice(context, state);
    await staleSkillsNotice(context);
}

function bundledNamed(name: string): Skill | undefined {
    return bundledSkills().find((skill: Skill) => skill.name === name);
}

const NOT_FOUND: number = 404;

/** The index the CLI gets is cut to the budget of the channel, so a unit may be open although it is not listed: the API decides. */
async function openedOutsideIndex(context: CliContext, state: OkState, name: string): Promise<RemoteSkill | null> {
    try {
        return await remoteSkill(clientOf(context, state.session), name);
    } catch (error: unknown) {
        if (error instanceof NexoApiError && error.problem.status === NOT_FOUND) {
            return null;
        }
        throw error;
    }
}

/** The skill of the client or the unit of context to open, read now with the token; null when the answer is a bundled skill or nothing. */
async function remoteToShow(
    context: CliContext,
    state: OkState,
    name: string,
    entry: RemoteSkillEntry | undefined,
    bundled: Skill | undefined
): Promise<RemoteSkill | null> {
    if (entry !== undefined) {
        return entry.level === 'product' ? null : remoteSkill(clientOf(context, state.session), name);
    }
    return bundled === undefined ? openedOutsideIndex(context, state, name) : null;
}

/** Prints one skill and writes nothing: the body of a skill of the client is read with the token at the time of use. */
export async function skillsShow(context: CliContext, name: string, options: SkillsOptions): Promise<void> {
    const state: RemoteState = await remoteState(context, options);
    const bundled: Skill | undefined = bundledNamed(name);
    const entry: RemoteSkillEntry | undefined =
        state.kind === 'ok' ? state.entries.find((each: RemoteSkillEntry) => each.name === name) : undefined;
    const remote: RemoteSkill | null = state.kind === 'ok' ? await remoteToShow(context, state, name, entry, bundled) : null;
    if (remote !== null) {
        printLine(context, options.json === true ? JSON.stringify(remote, null, 2) : remote.body);
        return;
    }
    if (bundled === undefined) {
        remoteNotice(context, state);
        throw usageError(`Não achei a skill ou a unidade de contexto ${name}.`, 'Veja os nomes com `nexo skills list`.');
    }
    printLine(context, options.json === true ? JSON.stringify({ name, level: 'product', body: bundled.body }, null, 2) : bundled.content);
    remoteNotice(context, state);
}
