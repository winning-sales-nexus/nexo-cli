export const TEMPLATE_CODE: string = `import type { ConnectorContext, ConnectorResult } from './connect-sdk';

export default async function run(ctx: ConnectorContext): Promise<ConnectorResult> {
    ctx.log('started', { mode: ctx.mode });
    return { done: true };
}
`;

export function templateManifest(): Record<string, unknown> {
    return {
        version: 1,
        triggers: [{ type: 'cron', everyMinutes: 60 }],
        hosts: [],
        secrets: [],
        reads: [],
        writes: [],
        externalWrites: false
    };
}

export const TEMPLATE_TSCONFIG: string = `${JSON.stringify(
    {
        compilerOptions: {
            target: 'ES2023',
            module: 'ESNext',
            moduleResolution: 'Bundler',
            lib: ['ES2023'],
            types: [],
            strict: true,
            noEmit: true,
            skipLibCheck: true
        },
        include: ['connector.ts', 'connect-sdk.d.ts']
    },
    null,
    2
)}\n`;
