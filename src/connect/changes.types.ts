export const CHANGES = ['publish', 'enable', 'pause'] as const;

export type ChangeKind = (typeof CHANGES)[number];
