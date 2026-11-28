import { clientOf, printJson, printLine, sessionOf } from '../context.js';
import type { CliContext, GlobalOptions } from '../context.js';
import { usageError } from '../errors.js';
import type { ApiResponse, HttpMethod } from '../http/nexo-client.js';
import { confirmed } from '../input/confirm.js';

export type BrainLevel = 'company' | 'area' | 'team' | 'person';

export interface BrainOptions extends GlobalOptions {
    readonly scope?: string;
    readonly area?: string;
    readonly team?: string;
    readonly name?: string;
    readonly description?: string;
    readonly body?: string;
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
    readonly answer?: readonly string[];
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
    readonly maxSkills?: number;
    readonly maxIndexChars?: number;
    readonly indexChars?: number;
}

interface Template {
    readonly id: string;
    readonly title: string;
    readonly moment: string;
    readonly available: boolean;
    readonly fields: readonly { readonly key: string; readonly label: string }[];
}

interface BlindPair {
    readonly id: string;
    readonly scenario: string;
    readonly a: string;
    readonly b: string;
}

interface BlindResult {
    readonly chosen: string;
    readonly withSkillAt: string;
    readonly withSkillChosen: boolean;
    readonly activated: boolean;
    readonly next: string;
}

interface AreaList {
    readonly areas: readonly { readonly id: string; readonly name: string }[];
}

const PATHS: Readonly<Record<BrainLevel, string>> = {
    company: '/v1/brain/company-skills',
    area: '/v1/brain/area-skills',
    team: '/v1/brain/team-skills',
    person: '/v1/brain/person-skills'
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
    if (raw === 'company' || raw === 'area' || raw === 'team' || raw === 'person') {
        return raw;
    }
    throw usageError(`Nível "${raw}" não existe: use company (empresa), area, team (time) ou person (pessoal).`);
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
    const free: boolean = options.name !== undefined || options.description !== undefined || options.body !== undefined;
    if (free) {
        return {
            name: required(options.name, '--name'),
            description: required(options.description, '--description'),
            body: required(options.body, '--body'),
            ...(options.objective === undefined ? {} : { objective: options.objective }),
            ...(options.moment === undefined ? {} : { moment: options.moment }),
            ...(always.length === 0 ? {} : { always }),
            ...(never.length === 0 ? {} : { never }),
            ...(options.example === undefined ? {} : { example: options.example })
        };
    }
    if (always.length + never.length === 0) {
        throw usageError(
            'Diga ao menos uma coisa para fazer sempre (--always) ou para nunca fazer (--never), ou escreva a skill com --name, --description e --body.'
        );
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
    const list: { readonly moments?: readonly string[] } = (await call(context, options, 'GET', '/v1/brain/skills/moments')) as {
        readonly moments?: readonly string[];
    };
    const moments: readonly string[] = list.moments ?? [];
    if (options.json === true) {
        printJson(context, { moments });
        return;
    }
    printLine(context, moments.length === 0 ? 'Nenhuma situação aceita skill nova por enquanto.' : moments.join('\n'));
}

export async function brainList(context: CliContext, rawLevel: string, options: BrainOptions): Promise<void> {
    const level: BrainLevel = levelOf(rawLevel);
    const query: Readonly<Record<string, string>> =
        options.scope === undefined || level === 'company' || level === 'person' ? {} : { scopeId: options.scope };
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
    if (level === 'person' && list.maxSkills !== undefined) {
        printLine(context, `${String(list.skills.length)} de ${String(list.maxSkills)} skills pessoais.`);
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
    printLine(context, 'Skill criada. Ela nasce em teste e só liga depois de provar que ajuda.');
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
    if (!(await confirmed(context, options.yes, `Apagar a skill ${skillId}?`))) {
        return;
    }
    await call(context, options, 'DELETE', skillPath(level, skillId));
    printLine(context, level === 'person' ? 'Skill apagada. Dá para restaurar em 30 dias, pelo app.' : 'Skill apagada.');
}

export async function brainTemplates(context: CliContext, options: BrainOptions): Promise<void> {
    const list: { readonly templates: readonly Template[] } = (await call(context, options, 'GET', `${PATHS.person}/templates`)) as {
        readonly templates: readonly Template[];
    };
    if (options.json === true) {
        printJson(context, list);
        return;
    }
    for (const template of list.templates) {
        const keys: string = template.fields.map((field) => `${field.key} (${field.label})`).join(', ');
        printLine(context, `${template.id}  ${template.title}  [${template.moment}${template.available ? '' : ', indisponível'}]`);
        printLine(context, `  campos: ${keys}`);
    }
}

function answersOf(values: readonly string[] | undefined): Record<string, string> {
    const answers: Record<string, string> = {};
    for (const value of listOf(values)) {
        const at: number = value.indexOf('=');
        const key: string = at < 0 ? '' : value.slice(0, at).trim();
        const text: string = at < 0 ? '' : value.slice(at + 1).trim();
        if (key === '' || text === '') {
            throw usageError(`Use --answer "campo=texto" (recebi "${value}").`);
        }
        answers[key] = text;
    }
    if (Object.keys(answers).length === 0) {
        throw usageError('Falta --answer "campo=texto" (um por campo do modelo; veja `nexo brain templates`).');
    }
    return answers;
}

export async function brainFromTemplate(context: CliContext, templateId: string, options: BrainOptions): Promise<void> {
    const body: unknown = { templateId, answers: answersOf(options.answer) };
    const skill: Skill = (await call(context, options, 'POST', `${PATHS.person}/from-template`, { body })) as Skill;
    if (options.json === true) {
        printJson(context, skill);
        return;
    }
    printLine(context, 'Skill pessoal criada a partir do modelo. Ela nasce em teste e só liga depois de provar que ajuda.');
    printSkill(context, skill);
}

export async function brainBlindTest(context: CliContext, skillId: string, options: BrainOptions): Promise<void> {
    const pair: BlindPair = (await call(context, options, 'POST', `${skillPath('person', skillId)}/blind-test`)) as BlindPair;
    if (options.json === true) {
        printJson(context, pair);
        return;
    }
    printLine(context, `Comparação ${pair.id}`);
    printLine(context, `Cenário: ${pair.scenario}`);
    printLine(context, `\n--- Texto A ---\n${pair.a}\n\n--- Texto B ---\n${pair.b}\n`);
    printLine(context, `Escolha o melhor, sem saber qual tem a skill: nexo brain choose ${pair.id} <a|b>`);
}

export async function brainChoose(context: CliContext, choiceId: string, chosen: string, options: BrainOptions): Promise<void> {
    const pick: string = chosen.toLowerCase();
    if (pick !== 'a' && pick !== 'b') {
        throw usageError(`Escolha "a" ou "b" (recebi "${chosen}").`);
    }
    const result: BlindResult = (await call(
        context,
        options,
        'POST',
        `${PATHS.person}/blind-tests/${encodeURIComponent(choiceId)}/choose`,
        {
            body: { chosen: pick }
        }
    )) as BlindResult;
    if (options.json === true) {
        printJson(context, result);
        return;
    }
    printLine(context, `A skill estava no texto ${result.withSkillAt.toUpperCase()}; você escolheu ${result.chosen.toUpperCase()}.`);
    printLine(
        context,
        result.next === 'ask_what_was_missing'
            ? 'A skill continua desligada: faltou algo nela. Diga o que faltava e edite a skill por item.'
            : result.activated
              ? 'Ganho confirmado: a skill está ligada.'
              : 'Ganho confirmado; a skill liga quando o teste aprovar esta versão.'
    );
}
