import { readFileSync, writeFileSync } from 'node:fs';
import { usageError } from '../errors.js';
import type { DocumentAgent, Questionnaire, QuestionnaireField, QuestionnaireGroup } from './journey.types.js';

export interface FileAnswer {
    readonly path: string;
    readonly text: string | null;
    readonly label?: string;
    readonly type?: string;
    readonly required?: boolean;
    readonly source?: string | null;
    readonly question?: string;
    readonly options?: readonly string[];
}

export interface GroupChange {
    readonly group: string;
    readonly action: 'add' | 'remove';
    readonly item?: number | null;
}

export interface AnswersFile {
    readonly agent: DocumentAgent | null;
    readonly dealId: string | null;
    readonly templateId: string | null;
    readonly proposalDocumentId: string | null;
    readonly documentId: string | null;
    readonly notes: string | null;
    readonly groups: readonly GroupChange[];
    readonly answers: readonly FileAnswer[];
}

export interface SentAnswer {
    readonly path: string;
    readonly text: string;
}

export function fieldsOf(questionnaire: Questionnaire): readonly QuestionnaireField[] {
    const grouped: readonly QuestionnaireField[] = questionnaire.groups.flatMap((group: QuestionnaireGroup) =>
        group.items.flatMap((item: { readonly fields: readonly QuestionnaireField[] }) => item.fields)
    );
    return [...questionnaire.fields, ...grouped];
}

function fileAnswerOf(field: QuestionnaireField): FileAnswer {
    const options: readonly string[] = field.question?.options.length ? field.question.options : field.options;
    return {
        path: field.path,
        label: field.label,
        type: field.type,
        required: field.required,
        text: field.text,
        source: field.source?.label ?? null,
        ...(field.question === null ? {} : { question: field.question.text }),
        ...(options.length === 0 ? {} : { options })
    };
}

export function answersFileOf(questionnaire: Questionnaire): AnswersFile {
    return {
        agent: questionnaire.agent,
        dealId: questionnaire.dealId,
        templateId: questionnaire.templateId,
        proposalDocumentId: questionnaire.proposal?.documentId ?? null,
        documentId: questionnaire.documentId,
        notes: questionnaire.notes,
        groups: [],
        answers: fieldsOf(questionnaire).map(fileAnswerOf)
    };
}

export function writeAnswersFile(path: string, file: AnswersFile): void {
    writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
}

function textOrNull(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}

function isAnswer(value: unknown): value is FileAnswer {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const fields: Partial<Record<keyof FileAnswer, unknown>> = value;
    return typeof fields.path === 'string' && (fields.text === null || typeof fields.text === 'string');
}

function isGroupChange(value: unknown): value is GroupChange {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const fields: Partial<Record<keyof GroupChange, unknown>> = value;
    return typeof fields.group === 'string' && (fields.action === 'add' || fields.action === 'remove');
}

function listOf<T>(path: string, key: string, value: unknown, valid: (item: unknown) => item is T, shape: string): readonly T[] {
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value) || !value.every(valid)) {
        throw usageError(`${path}: "${key}" precisa ser uma lista de ${shape}.`);
    }
    return value;
}

export function readJsonFile(path: string): unknown {
    try {
        return JSON.parse(readFileSync(path, 'utf8')) as unknown;
    } catch {
        throw usageError(`${path} não existe ou não é JSON válido.`);
    }
}

export function readAnswersFile(path: string): AnswersFile {
    const raw: unknown = readJsonFile(path);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw usageError(
            `${path} não tem o formato do arquivo de respostas.`,
            'Gere um com `nexo documents questionnaire … -o respostas.json`.'
        );
    }
    const fields: Partial<Record<keyof AnswersFile, unknown>> = raw;
    return {
        agent: fields.agent === 'proposal' || fields.agent === 'contract' ? fields.agent : null,
        dealId: textOrNull(fields.dealId),
        templateId: textOrNull(fields.templateId),
        proposalDocumentId: textOrNull(fields.proposalDocumentId),
        documentId: textOrNull(fields.documentId),
        notes: textOrNull(fields.notes),
        groups: listOf(path, 'groups', fields.groups, isGroupChange, '{ "group", "action": "add" ou "remove" }'),
        answers: listOf(path, 'answers', fields.answers, isAnswer, '{ "path", "text" }')
    };
}

export function changedAnswers(file: AnswersFile, baseline: Questionnaire): readonly SentAnswer[] {
    const known: ReadonlyMap<string, string> = new Map(
        fieldsOf(baseline).map((field: QuestionnaireField): [string, string] => [field.path, (field.text ?? '').trim()])
    );
    return file.answers
        .map((answer: FileAnswer): SentAnswer => ({ path: answer.path, text: (answer.text ?? '').trim() }))
        .filter((answer: SentAnswer) => answer.text !== (known.get(answer.path) ?? ''));
}
