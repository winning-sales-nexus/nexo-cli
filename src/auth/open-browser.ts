import { spawn } from 'node:child_process';

export type UrlOpener = (url: string) => Promise<boolean>;

function commandFor(platform: NodeJS.Platform, url: string): readonly [string, readonly string[]] {
    if (platform === 'darwin') {
        return ['open', [url]];
    }
    if (platform === 'win32') {
        return ['rundll32', ['url.dll,FileProtocolHandler', url]];
    }
    return ['xdg-open', [url]];
}

export const openInBrowser: UrlOpener = (url: string) => {
    const [command, args] = commandFor(process.platform, url);
    return new Promise<boolean>((resolve: (opened: boolean) => void) => {
        try {
            const child: ReturnType<typeof spawn> = spawn(command, [...args], { stdio: 'ignore', detached: true });
            child.once('error', () => {
                resolve(false);
            });
            child.once('spawn', () => {
                child.unref();
                resolve(true);
            });
        } catch {
            resolve(false);
        }
    });
};
