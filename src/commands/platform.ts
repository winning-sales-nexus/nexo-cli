import { clientOf, printJson, printLine, printNotice, sessionOf } from '../context.js';
import type { CliContext, GlobalOptions } from '../context.js';
import { usageError } from '../errors.js';
import type { paths } from '../generated/openapi.js';
import type { ApiResponse } from '../http/nexo-client.js';

export interface UseOptions extends GlobalOptions {
    readonly none?: boolean;
}

type Companies = paths['/v1/platform/companies']['get']['responses'][200]['content']['application/json'];
type Company = Companies['companies'][number];

const UUID: RegExp = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isCompany(value: unknown): value is Company {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const fields: Partial<Record<'id' | 'name', unknown>> = value;
    return typeof fields.id === 'string' && typeof fields.name === 'string';
}

async function fetchCompanies(context: CliContext, options: GlobalOptions, search?: string): Promise<readonly Company[]> {
    const response: ApiResponse = await clientOf(context, sessionOf(context, options)).request({
        method: 'GET',
        path: '/v1/platform/companies',
        ...(search === undefined || search.trim() === '' ? {} : { query: { search: search.trim() } })
    });
    const list: unknown = (response.body as { companies?: unknown } | null)?.companies;
    if (!Array.isArray(list) || !list.every(isCompany)) {
        throw new Error('Resposta inesperada de /v1/platform/companies.');
    }
    return list;
}

function lineOf(company: Company): string {
    return `${company.id}  ${company.name}${company.suspended ? '  (suspensa por cobrança: só leitura)' : ''}`;
}

export async function companies(context: CliContext, search: string | undefined, options: GlobalOptions): Promise<void> {
    const list: readonly Company[] = await fetchCompanies(context, options, search);
    if (options.json === true) {
        printJson(context, { companies: list });
        return;
    }
    if (list.length === 0) {
        printNotice(context, search === undefined ? 'Nenhuma empresa.' : `Nenhuma empresa com "${search}" no nome.`);
        return;
    }
    list.forEach((company: Company) => {
        printLine(context, lineOf(company));
    });
    printNotice(context, 'Escolha uma com `nexo use <id ou nome>`.');
}

async function resolveCompany(context: CliContext, target: string, options: GlobalOptions): Promise<Company> {
    const trimmed: string = target.trim();
    const list: readonly Company[] = await fetchCompanies(context, options, UUID.test(trimmed) ? undefined : trimmed);
    const byId: Company | undefined = list.find((company: Company) => company.id.toLowerCase() === trimmed.toLowerCase());
    if (byId !== undefined) {
        return byId;
    }
    if (UUID.test(trimmed)) {
        throw usageError(`Nenhuma empresa com o id ${trimmed}.`, 'Veja as opções com `nexo companies`.');
    }
    const exact: readonly Company[] = list.filter((company: Company) => company.name.toLowerCase() === trimmed.toLowerCase());
    const matches: readonly Company[] = exact.length === 1 ? exact : list;
    if (matches.length === 1 && matches[0] !== undefined) {
        return matches[0];
    }
    if (matches.length === 0) {
        throw usageError(`Nenhuma empresa casa com "${trimmed}".`, 'Veja as opções com `nexo companies`.');
    }
    throw usageError(
        `"${trimmed}" casa com ${String(matches.length)} empresas; não escolhi nenhuma:\n${matches.map((company: Company) => `  ${lineOf(company)}`).join('\n')}`,
        'Rode `nexo use <id>` com o id da que você quer.'
    );
}

async function leaveCompany(context: CliContext, options: UseOptions): Promise<void> {
    await clientOf(context, sessionOf(context, options)).request({ method: 'DELETE', path: '/v1/platform/active-company' });
    if (options.json === true) {
        printJson(context, { activeCompany: null });
        return;
    }
    printLine(context, 'Nenhuma empresa escolhida.');
}

async function chooseCompany(context: CliContext, target: string, options: UseOptions): Promise<void> {
    const company: Company = await resolveCompany(context, target, options);
    const response: ApiResponse = await clientOf(context, sessionOf(context, options)).request({
        method: 'PUT',
        path: '/v1/platform/active-company',
        body: { companyId: company.id }
    });
    if (options.json === true) {
        printJson(context, response.body);
        return;
    }
    printLine(context, `Empresa ativa: ${company.name} (${company.id})`);
    if (company.suspended) {
        printNotice(context, 'A empresa está suspensa por cobrança: dentro dela, a conexão só lê.');
    }
}

export async function useCompany(context: CliContext, target: string | undefined, options: UseOptions): Promise<void> {
    const named: boolean = target !== undefined && target.trim() !== '';
    if (options.none === true && named) {
        throw usageError('Use `nexo use --none` sem empresa, ou `nexo use <empresa>`, não os dois.');
    }
    if (options.none === true) {
        await leaveCompany(context, options);
        return;
    }
    if (target === undefined || !named) {
        throw usageError(
            'Diga a empresa: `nexo use <id ou nome>`, ou `nexo use --none` para sair dela.',
            'Veja as opções com `nexo companies`.'
        );
    }
    await chooseCompany(context, target, options);
}
