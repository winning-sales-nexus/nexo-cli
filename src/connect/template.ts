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

export const TEMPLATE_README: string = `# Conector

\`connector.ts\` é o código e \`manifest.json\` diz no que ele mexe. Suba com \`nexo connect push -m "o que mudou"\`.

## Quando ele roda

O gatilho \`cron\` do manifesto tem duas formas. Use uma por gatilho.

A cada tanto tempo:

\`\`\`json
{ "type": "cron", "everyMinutes": 60 }
\`\`\`

Em horário fixo, no fuso da empresa (\`at\` aceita um horário ou uma lista; \`days\` é opcional e, sem ele, vale todo dia):

\`\`\`json
{ "type": "cron", "at": "22:00" }
{ "type": "cron", "at": ["08:00", "18:00"], "days": ["mon", "tue", "wed", "thu", "fri"] }
\`\`\`

A agenda muda no manifesto, com \`nexo connect push\` e \`nexo connect publish\`. \`nexo connect status\` mostra a agenda e a próxima execução.
`;
