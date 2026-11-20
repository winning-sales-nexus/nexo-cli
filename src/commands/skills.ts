import { existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { currentSession, profileName } from '../config/session.js';
import type { Session } from '../config/session.js';
import { clientOf, printJson, printLine, printNotice } from '../context.js';
import type { CliContext, GlobalOptions } from '../context.js';
import { CliError, usageError } from '../errors.js';
import type { NexoClient } from '../http/nexo-client.js';
import { NexoApiError } from '../http/problem.js';
import { LEVEL_LABELS, clientLevelOnly, remoteIndex, remoteSkill } from '../skills/remote-skills.js';
import type { RemoteSkill, RemoteSkillEntry } from '../skills/remote-skills.js';
import { bundledSkills } from '../skills/skill-files.js';
import type { Skill } from '../skills/skill-files.js';
import { SKILL_TARGETS } from '../skills/skill-targets.types.js';
import type { SkillTarget } from '../skills/skill-targets.types.js';
import { detectedTargets, installSkills } from '../skills/targets.js';
import { homeOf, installedUserTools, userToolsFor, writeUserSkills } from '../skills/user-skills.js';
import type { UserTool } from '../skills/user-skills.js';

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

async function clientSkillsOf(
    context: CliContext,
    session: Session,
    entries: readonly RemoteSkillEntry[]
): Promise<readonly RemoteSkill[]> {
    const client: NexoClient = clientOf(context, session);
    return Promise.all(clientLevelOnly(entries).map((entry: RemoteSkillEntry) => remoteSkill(client, entry.name)));
}

interface ClientInstall {
    readonly tools: readonly UserTool[];
    readonly skills: readonly string[];
    readonly files: readonly string[];
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
        const skills: readonly RemoteSkill[] = await clientSkillsOf(context, state.session, state.entries);
        const home: string = homeOf(context.env);
        const tools: readonly UserTool[] = userToolsFor(home, targets);
        const files: readonly string[] = writeUserSkills(home, tools, state.session.profile, skills);
        return { tools, skills: skills.map((skill: RemoteSkill) => skill.name), files };
    } catch (error: unknown) {
        printNotice(
            context,
            `Não consegui baixar as skills da empresa (${reasonOf(error)}); as que já estavam na sua pasta ficaram como estavam.`
        );
        return null;
    }
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
            clientSkills: client === null ? [] : client.skills,
            clientTools: client === null ? [] : client.tools,
            clientFiles: client === null ? [] : client.files
        });
        return;
    }
    for (const file of written) {
        printLine(context, `  ${relative(directory, file)}`);
    }
    printLine(context, `${String(skills.length)} skills do Nexo em ${targets.join(', ')}. Rode de novo depois de atualizar a CLI.`);
    if (client !== null) {
        printLine(
            context,
            `${String(client.skills.length)} skills da sua empresa, área e time na sua pasta (${client.tools.join(', ')}), fora do projeto. Rode de novo quando mudarem.`
        );
    }
    remoteNotice(context, state);
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
    readonly level: string;
    readonly description: string;
    readonly installed: readonly string[];
}

function productRows(directory: string): readonly ListRow[] {
    return bundledSkills().map((skill: Skill) => ({
        name: skill.name,
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
    return clientLevelOnly(state.entries).map((entry: RemoteSkillEntry) => ({
        name: entry.name,
        level: entry.status === 'tentative' ? `${LEVEL_LABELS[entry.level]}, em teste` : LEVEL_LABELS[entry.level],
        description: entry.description,
        installed: installedUserTools(home, state.session.profile, entry)
    }));
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
        const where: string = row.installed.length === 0 ? 'não instalada aqui' : `instalada: ${row.installed.join(', ')}`;
        printLine(context, `${row.name} [${row.level}] (${where})\n    ${row.description}`);
    }
    remoteNotice(context, state);
}

function bundledNamed(name: string): Skill | undefined {
    return bundledSkills().find((skill: Skill) => skill.name === name);
}

/** Prints one skill and writes nothing: the body of a skill of the client is read with the token at the time of use. */
export async function skillsShow(context: CliContext, name: string, options: SkillsOptions): Promise<void> {
    const state: RemoteState = await remoteState(context, options);
    const bundled: Skill | undefined = bundledNamed(name);
    const entry: RemoteSkillEntry | undefined =
        state.kind === 'ok' ? state.entries.find((each: RemoteSkillEntry) => each.name === name) : undefined;
    if (state.kind === 'ok' && entry !== undefined && entry.level !== 'product') {
        const skill: RemoteSkill = await remoteSkill(clientOf(context, state.session), name);
        printLine(context, options.json === true ? JSON.stringify(skill, null, 2) : skill.body);
        return;
    }
    if (bundled === undefined) {
        remoteNotice(context, state);
        throw usageError(`Não achei a skill ${name}.`, 'Veja os nomes com `nexo skills list`.');
    }
    printLine(context, options.json === true ? JSON.stringify({ name, level: 'product', body: bundled.body }, null, 2) : bundled.content);
    remoteNotice(context, state);
}
