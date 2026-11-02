import { normalized } from './pages.js';
import type { DocPage } from './pages.js';

export interface SearchHit {
    readonly page: DocPage;
    readonly score: number;
    readonly snippet: string;
}

const BODY_HITS_CAP: number = 20;
const SNIPPET_LENGTH: number = 160;

function termsOf(query: string): readonly string[] {
    return normalized(query)
        .split(/[^a-z0-9_.:/-]+/)
        .filter((term: string) => term.length > 1);
}

function occurrences(text: string, term: string): number {
    let count: number = 0;
    let from: number = text.indexOf(term);
    while (from !== -1 && count < BODY_HITS_CAP) {
        count += 1;
        from = text.indexOf(term, from + term.length);
    }
    return count;
}

function scoreOf(page: DocPage, terms: readonly string[]): number {
    const title: string = normalized(page.title);
    const description: string = normalized(page.description);
    const body: string = normalized(page.body);
    let score: number = 0;
    for (const term of terms) {
        const found: number = (title.includes(term) ? 10 : 0) + (description.includes(term) ? 4 : 0) + occurrences(body, term);
        if (found === 0) {
            return 0;
        }
        score += found;
    }
    return score;
}

function snippetOf(page: DocPage, terms: readonly string[]): string {
    const first: string = terms[0] ?? '';
    const line: string = page.body.split('\n').find((candidate: string) => normalized(candidate).includes(first)) ?? page.description;
    const clean: string = line.replace(/\s+/g, ' ').trim();
    return clean.length > SNIPPET_LENGTH ? `${clean.slice(0, SNIPPET_LENGTH - 1)}…` : clean;
}

export function searchPages(pages: readonly DocPage[], query: string, limit: number): readonly SearchHit[] {
    const terms: readonly string[] = termsOf(query);
    if (terms.length === 0) {
        return [];
    }
    return pages
        .map((page: DocPage) => ({ page, score: scoreOf(page, terms), snippet: '' }))
        .filter((hit: SearchHit) => hit.score > 0)
        .sort((left: SearchHit, right: SearchHit) => right.score - left.score)
        .slice(0, limit)
        .map((hit: SearchHit) => ({ ...hit, snippet: snippetOf(hit.page, terms) }));
}

export function pageNamed(pages: readonly DocPage[], name: string): DocPage | null {
    const wanted: string = normalized(name).trim();
    const bySlug: Map<string, DocPage> = new Map(pages.map((page: DocPage) => [page.slug, page]));
    const exact: DocPage | undefined = bySlug.get(wanted) ?? pages.find((page: DocPage) => normalized(page.title) === wanted);
    if (exact !== undefined) {
        return exact;
    }
    const partial: readonly DocPage[] = pages.filter(
        (page: DocPage) => page.slug.includes(wanted) || normalized(page.title).includes(wanted)
    );
    return partial.length === 1 ? (partial[0] ?? null) : null;
}
