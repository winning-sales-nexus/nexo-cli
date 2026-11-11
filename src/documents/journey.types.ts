export const DOCUMENT_AGENTS = ['proposal', 'contract'] as const;

export type DocumentAgent = (typeof DOCUMENT_AGENTS)[number];

export type VersionStatus = 'draft' | 'queued' | 'running' | 'ready' | 'failed';

export interface TemplateChoice {
    readonly id: string;
    readonly name: string;
    readonly format: string;
    readonly sectionCount: number | null;
    readonly contractType: string | null;
    readonly isDefault: boolean;
    readonly timesUsed: number;
    readonly ownUpload: boolean;
}

export interface TemplateChoices {
    readonly agent: DocumentAgent;
    readonly canAdd: boolean;
    readonly templates: readonly TemplateChoice[];
}

export interface TemplateUpload {
    readonly id: string;
    readonly name: string;
    readonly fileName: string;
    readonly shared: boolean;
    readonly state: 'reading' | 'ready' | 'failed';
    readonly failure: string | null;
}

export interface UploadTicket {
    readonly uploadId: string;
    readonly upload: { readonly url: string; readonly contentType: string };
}

export interface FileLink {
    readonly url: string;
    readonly expiresAt: string;
    readonly fileName?: string;
}

export interface QuestionnaireField {
    readonly path: string;
    readonly label: string;
    readonly type: string;
    readonly required: boolean;
    readonly options: readonly string[];
    readonly box: string;
    readonly text: string | null;
    readonly refused: string | null;
    readonly error: string | null;
    readonly source: { readonly label: string } | null;
    readonly status: 'filled' | 'missing' | 'invalid' | 'blank';
    readonly question: { readonly text: string; readonly reason: string; readonly options: readonly string[] } | null;
}

export interface QuestionnaireGroup {
    readonly key: string;
    readonly label: string;
    readonly itemLabel: string;
    readonly box: string;
    readonly min: number;
    readonly max: number | null;
    readonly items: readonly { readonly fields: readonly QuestionnaireField[] }[];
}

export interface Questionnaire {
    readonly agent: DocumentAgent;
    readonly templateId: string;
    readonly templateName: string;
    readonly dealId: string | null;
    readonly proposal: { readonly documentId: string } | null;
    readonly documentId: string | null;
    readonly boxes: readonly { readonly id: string; readonly title: string; readonly description: string }[];
    readonly fields: readonly QuestionnaireField[];
    readonly groups: readonly QuestionnaireGroup[];
    readonly notes: string | null;
    readonly reading: 'pending' | 'done' | 'unavailable';
}

export interface QuestionnaireResponse {
    readonly questionnaire: Questionnaire;
    readonly pending: readonly { readonly path: string; readonly label: string; readonly sentence: string }[];
    readonly refused: readonly { readonly path: string; readonly label: string; readonly reason: string }[];
    readonly readingFailure: string | null;
}

export interface VersionSummary {
    readonly id: string;
    readonly version: number;
    readonly status: VersionStatus;
    readonly failureReason: string | null;
    readonly changeRequest: string | null;
    readonly changeSummary: string | null;
    readonly valueFindings: readonly string[];
    readonly checkFindings: readonly string[];
    readonly createdAt: string;
}

export interface DocumentSummary {
    readonly id: string;
    readonly agent: DocumentAgent;
    readonly number: string | null;
    readonly title: string;
    readonly dealId: string | null;
    readonly current: VersionSummary | null;
    readonly acceptance: { readonly state: 'not_accepted' | 'accepted'; readonly version: number | null } | null;
    readonly updatedAt: string;
}

export interface DocumentView extends DocumentSummary {
    readonly versions: readonly VersionSummary[];
}

export interface WritingReceipt {
    readonly documentId: string;
    readonly number: string | null;
    readonly title: string;
    readonly versionId: string;
    readonly version: number;
    readonly status: VersionStatus;
}

export interface NegotiationPerson {
    readonly name: string | null;
    readonly email: string;
    readonly approver: boolean;
}
