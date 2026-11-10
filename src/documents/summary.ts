import type {
    DocumentSummary,
    DocumentView,
    QuestionnaireField,
    QuestionnaireGroup,
    QuestionnaireResponse,
    TemplateChoice,
    VersionSummary
} from './journey.types.js';

const AGENT_LABELS: Readonly<Record<string, string>> = { proposal: 'proposta', contract: 'contrato' };
const STATUS_LABELS: Readonly<Record<string, string>> = {
    draft: 'rascunho',
    queued: 'na fila',
    running: 'escrevendo',
    ready: 'pronta',
    failed: 'não saiu'
};

function valueOf(field: QuestionnaireField): string {
    if (field.status === 'invalid') {
        return `"${field.refused ?? ''}" não entrou: ${field.error ?? 'formato inválido'}`;
    }
    if (field.status === 'missing') {
        return 'falta responder';
    }
    return field.text ?? '—';
}

function fieldLines(field: QuestionnaireField, indent: string): readonly string[] {
    const source: string = field.source === null || field.status !== 'filled' ? '' : `  (${field.source.label})`;
    const line: string = `${indent}${field.label} [${field.path}]: ${valueOf(field)}${source}`;
    if (field.question === null) {
        return [line];
    }
    const options: string = field.question.options.length === 0 ? '' : ` Opções: ${field.question.options.join(' | ')}`;
    return [line, `${indent}    Pergunta: ${field.question.text} (${field.question.reason})${options}`];
}

function groupLines(group: QuestionnaireGroup): readonly string[] {
    const limit: string = group.max === null ? `mínimo ${String(group.min)}` : `de ${String(group.min)} a ${String(group.max)}`;
    const items: readonly string[] = group.items.flatMap((item: { readonly fields: readonly QuestionnaireField[] }, index: number) => [
        `    ${group.itemLabel} ${String(index + 1)}`,
        ...item.fields.flatMap((field: QuestionnaireField) => fieldLines(field, '      '))
    ]);
    return [`  ${group.label} [${group.key}]: ${String(group.items.length)} (${limit})`, ...items];
}

function linesByBox(response: QuestionnaireResponse): ReadonlyMap<string, readonly string[]> {
    const boxes: Map<string, string[]> = new Map<string, string[]>();
    const add = (box: string, lines: readonly string[]): void => {
        boxes.set(box, [...(boxes.get(box) ?? []), ...lines]);
    };
    response.questionnaire.fields.forEach((field: QuestionnaireField) => {
        add(field.box, fieldLines(field, '  '));
    });
    response.questionnaire.groups.forEach((group: QuestionnaireGroup) => {
        add(group.box, groupLines(group));
    });
    return boxes;
}

function closingLines(response: QuestionnaireResponse): readonly string[] {
    const refused: readonly string[] = response.refused.map(
        (each: { readonly label: string; readonly reason: string }) => `  - ${each.label}: ${each.reason}`
    );
    const pending: readonly string[] = response.pending.map((each: { readonly sentence: string }) => `  - ${each.sentence}`);
    return [
        ...(refused.length === 0 ? [] : ['Não entrou:', ...refused]),
        ...(pending.length === 0 ? ['Nada falta: o questionário fecha.'] : ['Falta:', ...pending])
    ];
}

export function describeQuestionnaire(response: QuestionnaireResponse): readonly string[] {
    const { questionnaire } = response;
    const byBox: ReadonlyMap<string, readonly string[]> = linesByBox(response);
    const titled: ReadonlySet<string> = new Set(questionnaire.boxes.map((box: { readonly id: string }) => box.id));
    const loose: readonly string[] = [...byBox.entries()].flatMap(([box, lines]: [string, readonly string[]]) =>
        titled.has(box) ? [] : lines
    );
    return [
        `Questionário do ${AGENT_LABELS[questionnaire.agent] ?? questionnaire.agent} com o modelo "${questionnaire.templateName}"`,
        ...(response.readingFailure === null ? [] : [`As conversas do negócio não foram lidas: ${response.readingFailure}`]),
        ...questionnaire.boxes.flatMap((box: { readonly id: string; readonly title: string; readonly description: string }) => [
            `${box.title} — ${box.description}`,
            ...(byBox.get(box.id) ?? [])
        ]),
        ...(loose.length === 0 ? [] : ['Outros campos', ...loose]),
        ...(questionnaire.notes === null ? [] : [`Observações: ${questionnaire.notes}`]),
        ...closingLines(response)
    ];
}

export function templateRow(template: TemplateChoice): string {
    const support: string = template.contractType ?? (template.sectionCount === null ? '' : `${String(template.sectionCount)} seções`);
    const marks: string = [
        template.isDefault ? 'padrão' : '',
        template.ownUpload ? 'só seu' : '',
        support,
        `usado ${String(template.timesUsed)} vez(es)`
    ]
        .filter((mark: string) => mark !== '')
        .join(', ');
    return `${template.id}  ${template.format.toUpperCase().padEnd(5)} ${template.name}  (${marks})`;
}

function standing(document: DocumentSummary): string {
    if (document.acceptance === null) {
        return '';
    }
    return document.acceptance.state === 'accepted' ? `  v${String(document.acceptance.version ?? '')} aceita` : '  rascunho';
}

export function documentRow(document: DocumentSummary): string {
    const current: string =
        document.current === null ? 'sem versão' : `v${String(document.current.version)} ${STATUS_LABELS[document.current.status] ?? ''}`;
    return `${document.id}  ${(AGENT_LABELS[document.agent] ?? document.agent).padEnd(8)} ${(document.number ?? '—').padEnd(14)} ${current}${standing(document)}  ${document.title}`;
}

function versionRow(version: VersionSummary): string {
    const note: string = version.changeSummary ?? version.changeRequest ?? '';
    const failure: string = version.failureReason === null ? '' : ` (${version.failureReason})`;
    return `  v${String(version.version)}  ${(STATUS_LABELS[version.status] ?? version.status).padEnd(10)}${failure}  ${version.createdAt}  ${note}`.trimEnd();
}

export function describeDocument(document: DocumentView): readonly string[] {
    return [documentRow(document), ...document.versions.map(versionRow)];
}
