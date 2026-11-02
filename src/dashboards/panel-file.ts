import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { usageError } from '../errors.js';

export const PANEL_FILE: string = 'dashboard.json';
export const PANEL_STATE_FILE: string = 'nexo-dashboard.json';

export interface Audience {
    readonly profiles?: readonly string[];
    readonly roles?: readonly string[];
}

export interface Layout {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}

export interface ReportFile {
    readonly key: string;
    readonly section: string | null;
    readonly queries: unknown;
    readonly presentation: unknown;
    readonly layout: Layout;
    readonly audience: Audience | null;
}

export interface SectionFile {
    readonly key: string;
    readonly title: string;
    readonly collapsed: boolean;
}

export interface TabFile {
    readonly key: string;
    readonly title: string;
    readonly variables: readonly unknown[];
    readonly audience: Audience | null;
    readonly sections: readonly SectionFile[];
    readonly reports: readonly ReportFile[];
}

export interface PanelFile {
    readonly name: string;
    readonly description: string | null;
    readonly variables: readonly unknown[];
    readonly settings: unknown;
    readonly tabs: readonly TabFile[];
}

export interface PanelState {
    readonly dashboardId: string | null;
}

interface RemoteReport {
    readonly id: string;
    readonly sectionId: string | null;
    readonly queries: unknown;
    readonly presentation: unknown;
    readonly layout: Layout;
    readonly audience: Audience | null;
}

interface RemoteTab {
    readonly id: string;
    readonly title: string;
    readonly variables: readonly unknown[] | null;
    readonly audience: Audience | null;
    readonly sections: readonly { readonly id: string; readonly title: string; readonly collapsed: boolean }[];
    readonly reports: readonly RemoteReport[];
}

export interface RemotePanel {
    readonly id: string;
    readonly name: string;
    readonly description: string | null;
    readonly variables: readonly unknown[];
    readonly settings: unknown;
    readonly headSeq: number;
    readonly tabs: readonly RemoteTab[];
}

function tabOf(tab: RemoteTab): TabFile {
    return {
        key: tab.id,
        title: tab.title,
        variables: tab.variables ?? [],
        audience: tab.audience,
        sections: tab.sections.map((section) => ({ key: section.id, title: section.title, collapsed: section.collapsed })),
        reports: tab.reports.map((report: RemoteReport) => ({
            key: report.id,
            section: report.sectionId,
            queries: report.queries,
            presentation: report.presentation,
            layout: { x: report.layout.x, y: report.layout.y, w: report.layout.w, h: report.layout.h },
            audience: report.audience
        }))
    };
}

export function panelFileOf(panel: RemotePanel): PanelFile {
    return {
        name: panel.name,
        description: panel.description,
        variables: panel.variables,
        settings: panel.settings,
        tabs: panel.tabs.map(tabOf)
    };
}

function readJson(path: string): unknown {
    try {
        return JSON.parse(readFileSync(path, 'utf8')) as unknown;
    } catch {
        throw usageError(`${path} não é JSON válido.`);
    }
}

export function readPanelFile(directory: string): PanelFile {
    const path: string = join(directory, PANEL_FILE);
    if (!existsSync(path)) {
        throw usageError(
            `Não há ${PANEL_FILE} em ${directory}.`,
            'Crie com `nexo dashboards init <pasta>` ou baixe com `nexo dashboards pull <id>`.'
        );
    }
    const panel: unknown = readJson(path);
    if (
        typeof panel !== 'object' ||
        panel === null ||
        typeof (panel as PanelFile).name !== 'string' ||
        !Array.isArray((panel as PanelFile).tabs)
    ) {
        throw usageError(`${PANEL_FILE} precisa de "name" e "tabs".`);
    }
    return panel as PanelFile;
}

export function writePanelFile(directory: string, panel: PanelFile): void {
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, PANEL_FILE), `${JSON.stringify(panel, null, 2)}\n`);
}

export function readPanelState(directory: string): PanelState {
    const path: string = join(directory, PANEL_STATE_FILE);
    if (!existsSync(path)) {
        return { dashboardId: null };
    }
    const state: unknown = readJson(path);
    const id: unknown = typeof state === 'object' && state !== null ? (state as { dashboardId?: unknown }).dashboardId : null;
    return { dashboardId: typeof id === 'string' ? id : null };
}

export function writePanelState(directory: string, state: PanelState): void {
    writeFileSync(join(directory, PANEL_STATE_FILE), `${JSON.stringify(state, null, 2)}\n`);
}

export function templatePanel(name: string): PanelFile {
    return {
        name,
        description: null,
        variables: [],
        settings: {},
        tabs: [{ key: 'principal', title: 'Principal', variables: [], audience: null, sections: [], reports: [] }]
    };
}
