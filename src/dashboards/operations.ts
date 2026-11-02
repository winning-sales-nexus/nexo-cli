import type { Audience, PanelFile, ReportFile, SectionFile, TabFile } from './panel-file.js';

export type Operation = Readonly<Record<string, unknown>> & { readonly op: string };

interface PlacedReport {
    readonly tab: string;
    readonly report: ReportFile;
}

function same(left: unknown, right: unknown): boolean {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function audienceOf(audience: Audience | null): Audience | null {
    if (audience === null || ((audience.profiles ?? []).length === 0 && (audience.roles ?? []).length === 0)) {
        return null;
    }
    return { profiles: audience.profiles ?? [], roles: audience.roles ?? [] };
}

function reportsOf(panel: PanelFile | null): Map<string, PlacedReport> {
    const reports: Map<string, PlacedReport> = new Map<string, PlacedReport>();
    for (const tab of panel?.tabs ?? []) {
        tab.reports.forEach((report: ReportFile) => reports.set(report.key, { tab: tab.key, report }));
    }
    return reports;
}

function panelOperations(local: PanelFile, remote: PanelFile | null): readonly Operation[] {
    const changed: boolean =
        remote === null ||
        local.name !== remote.name ||
        !same(local.description, remote.description) ||
        !same(local.variables, remote.variables) ||
        !same(local.settings, remote.settings);
    return changed
        ? [{ op: 'set_panel', name: local.name, description: local.description, variables: local.variables, settings: local.settings }]
        : [];
}

function newTabOperations(tab: TabFile): readonly Operation[] {
    const audience: Audience | null = audienceOf(tab.audience);
    return [
        { op: 'add_tab', key: tab.key, title: tab.title, variables: tab.variables },
        ...(audience === null ? [] : [{ op: 'set_tab_audience', tab: tab.key, audience }])
    ];
}

function tabChanges(tab: TabFile, before: TabFile): readonly Operation[] {
    const operations: Operation[] = [];
    if (tab.title !== before.title) {
        operations.push({ op: 'rename_tab', tab: tab.key, title: tab.title });
    }
    if (!same(tab.variables, before.variables)) {
        operations.push({ op: 'set_tab_variables', tab: tab.key, variables: tab.variables });
    }
    if (!same(audienceOf(tab.audience), audienceOf(before.audience))) {
        operations.push({ op: 'set_tab_audience', tab: tab.key, audience: audienceOf(tab.audience) ?? { profiles: [], roles: [] } });
    }
    return operations;
}

function sectionOperations(tab: TabFile, before: TabFile | undefined): readonly Operation[] {
    const previous: Map<string, SectionFile> = new Map((before?.sections ?? []).map((section: SectionFile) => [section.key, section]));
    const current: Set<string> = new Set(tab.sections.map((section: SectionFile) => section.key));
    const removed: readonly Operation[] = [...previous.keys()]
        .filter((key: string) => !current.has(key))
        .map((key: string) => ({ op: 'remove_section', tab: tab.key, section: key }));
    const upserts: readonly Operation[] = tab.sections.flatMap((section: SectionFile): readonly Operation[] => {
        const old: SectionFile | undefined = previous.get(section.key);
        if (old === undefined) {
            return [{ op: 'add_section', tab: tab.key, key: section.key, title: section.title, collapsed: section.collapsed }];
        }
        return old.title === section.title && old.collapsed === section.collapsed
            ? []
            : [{ op: 'change_section', tab: tab.key, section: section.key, title: section.title, collapsed: section.collapsed }];
    });
    return [...removed, ...upserts];
}

function layoutOf(placed: PlacedReport): Readonly<Record<string, unknown>> {
    return { tab: placed.tab, section: placed.report.section, ...placed.report.layout };
}

function reportChange(placed: PlacedReport, before: PlacedReport): readonly Operation[] {
    const change: Record<string, unknown> = {};
    if (!same(placed.report.queries, before.report.queries)) {
        change.queries = placed.report.queries;
    }
    if (!same(placed.report.presentation, before.report.presentation)) {
        change.presentation = placed.report.presentation;
    }
    if (!same(layoutOf(placed), layoutOf(before))) {
        change.layout = layoutOf(placed);
    }
    const operations: Operation[] = Object.keys(change).length === 0 ? [] : [{ op: 'change_report', report: placed.report.key, ...change }];
    if (!same(audienceOf(placed.report.audience), audienceOf(before.report.audience))) {
        operations.push({
            op: 'set_report_audience',
            report: placed.report.key,
            audience: audienceOf(placed.report.audience) ?? { profiles: [], roles: [] }
        });
    }
    return operations;
}

function reportOperations(
    local: PanelFile,
    remote: PanelFile | null
): { readonly removed: readonly Operation[]; readonly upserts: readonly Operation[] } {
    const previous: Map<string, PlacedReport> = reportsOf(remote);
    const current: Map<string, PlacedReport> = reportsOf(local);
    const removed: readonly Operation[] = [...previous.keys()]
        .filter((key: string) => !current.has(key))
        .map((key: string) => ({ op: 'remove_report', report: key }));
    const upserts: readonly Operation[] = [...current.values()].flatMap((placed: PlacedReport): readonly Operation[] => {
        const before: PlacedReport | undefined = previous.get(placed.report.key);
        if (before !== undefined) {
            return reportChange(placed, before);
        }
        const audience: Audience | null = audienceOf(placed.report.audience);
        const add: Operation = {
            op: 'add_report',
            key: placed.report.key,
            queries: placed.report.queries,
            presentation: placed.report.presentation,
            layout: layoutOf(placed)
        };
        return audience === null ? [add] : [add, { op: 'set_report_audience', report: placed.report.key, audience }];
    });
    return { removed, upserts };
}

export function operationsFor(local: PanelFile, remote: PanelFile | null): readonly Operation[] {
    const previousTabs: Map<string, TabFile> = new Map((remote?.tabs ?? []).map((tab: TabFile) => [tab.key, tab]));
    const currentTabs: Set<string> = new Set(local.tabs.map((tab: TabFile) => tab.key));
    const reports: { readonly removed: readonly Operation[]; readonly upserts: readonly Operation[] } = reportOperations(local, remote);
    const removedTabs: readonly Operation[] = [...previousTabs.keys()]
        .filter((key: string) => !currentTabs.has(key))
        .map((key: string) => ({ op: 'remove_tab', tab: key }));
    const tabs: readonly Operation[] = local.tabs.flatMap((tab: TabFile) => {
        const before: TabFile | undefined = previousTabs.get(tab.key);
        return before === undefined ? newTabOperations(tab) : tabChanges(tab, before);
    });
    const sections: readonly Operation[] = local.tabs.flatMap((tab: TabFile) => sectionOperations(tab, previousTabs.get(tab.key)));
    return [...reports.removed, ...removedTabs, ...panelOperations(local, remote), ...tabs, ...sections, ...reports.upserts];
}
