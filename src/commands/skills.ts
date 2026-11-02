import { existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { printJson, printLine } from '../context.js';
import type { CliContext, GlobalOptions } from '../context.js';
import { usageError } from '../errors.js';
import { bundledSkills } from '../skills/skill-files.js';
import type { Skill } from '../skills/skill-files.js';
import { SKILL_TARGETS } from '../skills/skill-targets.types.js';
import type { SkillTarget } from '../skills/skill-targets.types.js';
import { detectedTargets, installSkills } from '../skills/targets.js';

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

export function skillsInstall(context: CliContext, options: SkillsOptions): void {
    const directory: string = resolve(options.dir ?? '.');
    const skills: readonly Skill[] = bundledSkills();
    const targets: readonly SkillTarget[] = chosenTargets(options, directory);
    const written: readonly string[] = targets.flatMap((target: SkillTarget) => installSkills(directory, target, skills));
    if (options.json === true) {
        printJson(context, { directory, targets, skills: skills.map((skill: Skill) => skill.name), files: written });
        return;
    }
    for (const file of written) {
        printLine(context, `  ${relative(directory, file)}`);
    }
    printLine(context, `${String(skills.length)} skills do Nexo em ${targets.join(', ')}. Rode de novo depois de atualizar a CLI.`);
}

function installedIn(directory: string, skill: Skill): readonly SkillTarget[] {
    const paths: Readonly<Record<SkillTarget, string>> = {
        claude: join(directory, '.claude', 'skills', skill.name, 'SKILL.md'),
        cursor: join(directory, '.cursor', 'rules', `${skill.name}.mdc`),
        agents: join(directory, '.nexo', 'skills', `${skill.name}.md`)
    };
    return SKILL_TARGETS.filter((target: SkillTarget) => existsSync(paths[target]));
}

export function skillsList(context: CliContext, options: SkillsOptions): void {
    const directory: string = resolve(options.dir ?? '.');
    const skills: readonly Skill[] = bundledSkills();
    const rows: readonly { name: string; description: string; installed: readonly SkillTarget[] }[] = skills.map((skill: Skill) => ({
        name: skill.name,
        description: skill.description,
        installed: installedIn(directory, skill)
    }));
    if (options.json === true) {
        printJson(context, rows);
        return;
    }
    for (const row of rows) {
        const where: string = row.installed.length === 0 ? 'não instalada aqui' : `instalada: ${row.installed.join(', ')}`;
        printLine(context, `${row.name} (${where})\n    ${row.description}`);
    }
}
