import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Skill } from './skill-files.js';
import type { SkillTarget } from './skill-targets.types.js';

export const BLOCK_START: string = '<!-- nexo-skills:start -->';
export const BLOCK_END: string = '<!-- nexo-skills:end -->';

function writeFile(path: string, content: string): string {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    return path;
}

function cursorRule(skill: Skill): string {
    return `---\ndescription: ${skill.description}\nglobs:\nalwaysApply: false\n---\n\n${skill.body}\n`;
}

function agentsBlock(skills: readonly Skill[]): string {
    const lines: readonly string[] = skills.map((skill: Skill) => `- \`.nexo/skills/${skill.name}.md\`: ${skill.description}`);
    return [
        BLOCK_START,
        '## Nexo',
        '',
        'Antes de mexer com o Nexo (API, Connect, painéis), leia a skill do assunto e use a CLI `nexo` (`nexo --help`, `nexo docs search`):',
        '',
        ...lines,
        BLOCK_END
    ].join('\n');
}

export function withAgentsBlock(current: string, skills: readonly Skill[]): string {
    const block: string = agentsBlock(skills);
    const start: number = current.indexOf(BLOCK_START);
    const end: number = current.indexOf(BLOCK_END);
    if (start !== -1 && end > start) {
        return `${current.slice(0, start)}${block}${current.slice(end + BLOCK_END.length)}`;
    }
    const separator: string = current === '' || current.endsWith('\n\n') ? '' : current.endsWith('\n') ? '\n' : '\n\n';
    return `${current}${separator}${block}\n`;
}

function installAgents(directory: string, skills: readonly Skill[]): readonly string[] {
    const written: string[] = skills.map((skill: Skill) =>
        writeFile(join(directory, '.nexo', 'skills', `${skill.name}.md`), skill.content)
    );
    const agentsFile: string = join(directory, 'AGENTS.md');
    const current: string = existsSync(agentsFile) ? readFileSync(agentsFile, 'utf8') : '';
    written.push(writeFile(agentsFile, withAgentsBlock(current, skills)));
    return written;
}

export function installSkills(directory: string, target: SkillTarget, skills: readonly Skill[]): readonly string[] {
    if (target === 'claude') {
        return skills.map((skill: Skill) => writeFile(join(directory, '.claude', 'skills', skill.name, 'SKILL.md'), skill.content));
    }
    if (target === 'cursor') {
        return skills.map((skill: Skill) => writeFile(join(directory, '.cursor', 'rules', `${skill.name}.mdc`), cursorRule(skill)));
    }
    return installAgents(directory, skills);
}

export function detectedTargets(directory: string): readonly SkillTarget[] {
    const found: SkillTarget[] = [];
    if (existsSync(join(directory, '.claude')) || existsSync(join(directory, 'CLAUDE.md'))) {
        found.push('claude');
    }
    if (existsSync(join(directory, '.cursor'))) {
        found.push('cursor');
    }
    if (existsSync(join(directory, 'AGENTS.md')) || existsSync(join(directory, '.codex'))) {
        found.push('agents');
    }
    return found;
}
