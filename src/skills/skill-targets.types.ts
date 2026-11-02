export const SKILL_TARGETS = ['claude', 'cursor', 'agents'] as const;

export type SkillTarget = (typeof SKILL_TARGETS)[number];
