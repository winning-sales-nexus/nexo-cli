export interface DocPage {
    readonly slug: string;
    readonly title: string;
    readonly description: string;
    readonly body: string;
}

export interface DocBundle {
    readonly source: string;
    readonly fetchedAt: string;
    readonly pages: readonly DocPage[];
}

const SECTION_ANCHOR: RegExp = /^\[Seção intitulada .*\]\(#.*\)$/;

export function normalized(text: string): string {
    return text
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase();
}

export function slugOf(title: string): string {
    return normalized(title)
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function startsPage(lines: readonly string[], index: number): boolean {
    return /^# \S/.test(lines[index] ?? '') && lines[index + 1] === '' && (lines[index + 2] ?? '').startsWith('> ');
}

function pageStarts(lines: readonly string[]): readonly number[] {
    const starts: number[] = [];
    let fenced: boolean = false;
    lines.forEach((line: string, index: number) => {
        if (line.startsWith('```')) {
            fenced = !fenced;
        }
        if (!fenced && startsPage(lines, index)) {
            starts.push(index);
        }
    });
    return starts;
}

function pageAt(lines: readonly string[], start: number, end: number): DocPage {
    const title: string = (lines[start] ?? '').slice(2).trim();
    const description: string = (lines[start + 2] ?? '').slice(2).trim();
    const body: string = lines
        .slice(start + 3, end)
        .filter((line: string) => !SECTION_ANCHOR.test(line))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return { slug: slugOf(title), title, description, body };
}

export function splitPages(fullText: string): readonly DocPage[] {
    const lines: readonly string[] = fullText.replace(/\r\n/g, '\n').split('\n');
    const starts: readonly number[] = pageStarts(lines);
    return starts.map((start: number, position: number) => pageAt(lines, start, starts[position + 1] ?? lines.length));
}
