import { createRequire } from 'node:module';

interface PackageManifest {
    readonly version: string;
}

function isManifest(value: unknown): value is PackageManifest {
    return typeof value === 'object' && value !== null && typeof (value as { version?: unknown }).version === 'string';
}

function readVersion(): string {
    const manifest: unknown = createRequire(import.meta.url)('../package.json');
    return isManifest(manifest) ? manifest.version : '0.0.0';
}

export const CLI_VERSION: string = readVersion();

export const USER_AGENT: string = `nexo-cli/${CLI_VERSION} node/${process.versions.node} ${process.platform}`;
