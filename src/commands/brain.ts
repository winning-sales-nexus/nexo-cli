import { clientOf, printJson, printLine, sessionOf } from '../context.js';
import type { CliContext, GlobalOptions } from '../context.js';
import { usageError } from '../errors.js';
import type { ApiResponse, HttpMethod } from '../http/nexo-client.js';
import { confirmed } from '../input/confirm.js';

export type BrainLevel = 'company' | 'area' | 'team';

export interface BrainOptions extends GlobalOptions {
    readonly scope?: string;
    readonly area?: string;
    readonly team?: string;
    readonly objective?: string;
    readonly moment?: string;
    readonly always?: readonly string[];
    readonly never?: readonly string[];
    readonly example?: string;
    readonly addAlways?: readonly string[];
    readonly addNever?: readonly string[];
    readonly removeAlways?: readonly string[];
    readonly removeNever?: readonly string[];
    readonly updateAlways?: readonly string[];
    readonly updateNever?: readonly string[];
    readonly confirmShrink?: boolean;
    readonly yes?: boolean;
}

type ItemList = 'sempre' | 'nunca';

type ItemChange =
    | { readonly op: 'add'; readonly list: ItemList; readonly item: string }
    | { readonly op: 'update'; readonly list: ItemList; readonly item: string; readonly to: string }
    | { readonly op: 'remove'; readonly list: ItemList; readonly item: string };

interface Skill {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly status: string;
    readonly version: number;
    readonly moments?: readonly string[];
    readonly scopeId?: string;
    readonly level?: string;
}

interface SkillList {
    readonly skills: readonly Skill[];
    readonly momentsOffered?: readonly string[];
}

interface AreaList {
    readonly areas: readonly { readonly id: string; readonly name: string }[];
}

const PATHS: Readonly<Record<BrainLevel, string>> = {
    company: '/v1/brain/company-skills',
    area: '/v1/brain/area-skills',
    team: '/v1/brain/team-skills'
};

const UPDATE_SEPARATOR: string = '=>';

async function call(
    context: CliContext,
    options: GlobalOptions,
    method: HttpMethod,
    path: string,
    extra: { readonly query?: Readonly<Record<string, string>>; readonly body?: unknown } = {}
): Promise<unknown> {
    const response: ApiResponse = await clientOf(context, sessionOf(context, options)).request({ method, path, ...extra });
    return response.body;
}

function levelOf(raw: string): BrainLevel {
    if (raw === 'company' || raw === 'area' || raw === 'team') {
        return raw;
    }
    throw usageError(`Nível "${raw}" não existe: use company (empresa), area ou team (time).`);
}

function skillPath(level: BrainLevel, skillId: string): string {
    return `${PATHS[level]}/${encodeURIComponent(skillId)}`;
}

function listOf(values: readonly string[] | undefined): readonly string[] {
    return values ?? [];
}

function updatesOf(list: ItemList, values: readonly string[] | undefined): readonly ItemChange[] {
    return listOf(values).map((value: string): ItemChange => {
        const at: number = value.indexOf(UPDATE_SEPARATOR);
        const item: string = at < 0 ? '' : value.slice(0, at).trim();
        const to: string = at < 0 ? '' : value.slice(at + UPDATE_SEPARATOR.length).trim();
        if (item === '' || to === '') {
            throw usageError(`Para atualizar um item, use "item atual ${UPDATE_SEPARATOR} item novo" (recebi "${value}").`);
        }
        return { op: 'update', list, item, to };
    });
}

function changesOf(options: BrainOptions): readonly ItemChange[] {
    const adds = (list: ItemList, values: readonly string[] | undefined): readonly ItemChange[] =>
        listOf(values).map((item: string): ItemChange => ({ op: 'add', list, item }));
    const removes = (list: ItemList, values: readonly string[] | undefined): readonly ItemChange[] =>
        listOf(values).map((item: string): ItemChange => ({ op: 'remove', list, item }));
    return [
        ...adds('sempre', options.addAlways),
        ...adds('nunca', options.addNever),
        ...updatesOf('sempre', options.updateAlways),
        ...updatesOf('nunca', options.updateNever),
        ...removes('sempre', options.removeAlways),
        ...removes('nunca', options.removeNever)
    ];
}

function required(value: string | undefined, flag: string): string {
    if (value === undefined || value.trim() === '') {
        throw usageError(`Falta ${flag}.`);
    }
    return value;
}

function ideaOf(options: BrainOptions): Record<string, unknown> {
    const always: readonly string[] = listOf(options.always);
    const never: readonly string[] = listOf(options.never);
    if (always.length + never.length === 0) {
        throw usageError('Diga ao menos uma coisa para fazer sempre (--always) ou para nunca fazer (--never).');
    }
    return {
        objective: required(options.objective, '--objective'),
        moment: required(options.moment, '--moment'),
        always,
        never,
        example: required(options.example, '--example')
    };
}

function printSkill(context: CliContext, skill: Skill): void {
    printLine(context, `${skill.id}  ${skill.name}  [${skill.status}, versão ${String(skill.version)}]`);
    printLine(context, `  ${skill.description}`);
}

export async function brainAreas(context: CliContext, options: BrainOptions): Promise<void> {
    const list: AreaList = (await call(context, options, 'GET', '/v1/brain/areas')) as AreaList;
    if (options.json === true) {
        printJson(context, list);
        return;
    }
    for (const area of list.areas) {
        printLine(context, `${area.id}  ${area.name}`);
    }
}

export async function brainMoments(context: CliContext, options: BrainOptions): Promise<void> {
    const list: SkillList = (await call(context, options, 'GET', PATHS.area)) as SkillList;
    const moments: readonly string[] = list.momentsOffered ?? [];
    if (options.json === true) {
        printJson(context, { moments });
        return;
    }
    printLine(context, moments.length === 0 ? 'Nenhum momento aceita skill nova por enquanto.' : moments.join('\n'));
}

export async function brainList(context: CliContext, rawLevel: string, options: BrainOptions): Promise<void> {
    const level: BrainLevel = levelOf(rawLevel);
    if (level === 'company') {
        throw usageError('A API pública não lista as skills da empresa: use `nexo skills list` (com login) ou o app.');
    }
    const query: Readonly<Record<string, string>> = options.scope === undefined ? {} : { scopeId: options.scope };
    const list: SkillList = (await call(context, options, 'GET', PATHS[level], { query })) as SkillList;
    if (options.json === true) {
        printJson(context, list);
        return;
    }
    if (list.skills.length === 0) {
        printLine(context, 'Nenhuma skill neste nível.');
    }
    for (const skill of list.skills) {
        printSkill(context, skill);
    }
}

export async function brainCreate(context: CliContext, rawLevel: string, options: BrainOptions): Promise<void> {
    const level: BrainLevel = levelOf(rawLevel);
    const idea: Record<string, unknown> = ideaOf(options);
    const where: Record<string, unknown> =
        level === 'area'
            ? { areaId: required(options.area, '--area') }
            : level === 'team'
              ? { teamId: required(options.team, '--team') }
              : {};
    const skill: Skill = (await call(context, options, 'POST', PATHS[level], { body: { ...where, ...idea } })) as Skill;
    if (options.json === true) {
        printJson(context, skill);
        return;
    }
    printLine(context, 'Skill criada. Ela nasce em teste e só liga depois do teste "não piora" e da escolha às cegas.');
    printSkill(context, skill);
}

export async function brainEdit(context: CliContext, rawLevel: string, skillId: string, options: BrainOptions): Promise<void> {
    const level: BrainLevel = levelOf(rawLevel);
    const changes: readonly ItemChange[] = changesOf(options);
    if (changes.length === 0) {
        throw usageError(
            'Nenhuma mudança: use --add-always, --add-never, --update-always, --update-never, --remove-always ou --remove-never.'
        );
    }
    const body: unknown = { changes, confirmShrink: options.confirmShrink === true };
    const skill: Skill = (await call(context, options, 'PUT', skillPath(level, skillId), { body })) as Skill;
    if (options.json === true) {
        printJson(context, skill);
        return;
    }
    printLine(context, `Skill editada: versão ${String(skill.version)}.`);
    printSkill(context, skill);
}

export async function brainRemove(context: CliContext, rawLevel: string, skillId: string, options: BrainOptions): Promise<void> {
    const level: BrainLevel = levelOf(rawLevel);
    if (level === 'company') {
        throw usageError('A API pública não apaga skill da empresa: use o app.');
    }
    if (!(await confirmed(context, options.yes, `Apagar a skill ${skillId}?`))) {
        return;
    }
    await call(context, options, 'DELETE', skillPath(level, skillId));
    printLine(context, 'Skill apagada.');
}
