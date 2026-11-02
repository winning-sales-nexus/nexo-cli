export const EXIT_CODES = {
    ok: 0,
    failure: 1,
    usage: 2,
    unauthenticated: 3,
    forbidden: 4,
    notFound: 5,
    rateLimited: 6
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];
