import { clientOf, printJson, printLine, printNotice, sessionOf } from '../context.js';
import type { CliContext, GlobalOptions } from '../context.js';
import { usageError } from '../errors.js';
import type { paths } from '../generated/openapi.js';
import type { ApiResponse } from '../http/nexo-client.js';
import { resolveCompany } from './platform.js';
import type { Company } from './platform.js';

export interface FeatureOnOptions extends GlobalOptions {
    readonly withRequired?: boolean;
}

type Features = paths['/v1/platform/companies/{companyId}/capabilities']['get']['responses'][200]['content']['application/json'];
type Feature = Features['capabilities'][number];

const SOURCE_TEXT: Readonly<Record<Feature['source'], string>> = {
    plan: 'do plano',
    granted: 'liberada à mão',
    revoked: 'tirada à mão',
    addon: 'add-on pago',
    none: 'fora do plano'
};

function isFeatures(value: unknown): value is Features {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const fields: Partial<Record<'company' | 'capabilities', unknown>> = value;
    return typeof fields.company === 'object' && fields.company !== null && Array.isArray(fields.capabilities);
}

function featuresOf(response: ApiResponse): Features {
    if (!isFeatures(response.body)) {
        throw new Error('Resposta inesperada de /v1/platform/companies/{id}/capabilities.');
    }
    return response.body;
}

function lineOf(feature: Feature): string {
    return `${feature.allowed ? '[x]' : '[ ]'} ${feature.capability}  ${feature.displayName}  (${SOURCE_TEXT[feature.source]})`;
}

function pathOf(companyId: string, feature?: string): string {
    const base: string = `/v1/platform/companies/${companyId}/capabilities`;
    return feature === undefined ? base : `${base}/${encodeURIComponent(feature)}`;
}

export async function listFeatures(context: CliContext, target: string, options: GlobalOptions): Promise<void> {
    const company: Company = await resolveCompany(context, target, options);
    const features: Features = featuresOf(
        await clientOf(context, sessionOf(context, options)).request({ method: 'GET', path: pathOf(company.id) })
    );
    if (options.json === true) {
        printJson(context, features);
        return;
    }
    printLine(context, `${features.company.name} (${features.company.id})`);
    features.capabilities.forEach((feature: Feature) => {
        printLine(context, lineOf(feature));
    });
    printNotice(context, 'Libere com `nexo features on <empresa> <função>`, tire com `nexo features off <empresa> <função>`.');
}

export async function setFeature(
    context: CliContext,
    target: string,
    feature: string,
    allowed: boolean,
    options: FeatureOnOptions
): Promise<void> {
    if (feature.trim() === '') {
        throw usageError('Diga a função.', 'Veja as chaves com `nexo features list <empresa>`.');
    }
    const company: Company = await resolveCompany(context, target, options);
    const features: Features = featuresOf(
        await clientOf(context, sessionOf(context, options)).request({
            method: 'PUT',
            path: pathOf(company.id, feature.trim()),
            body: { allowed, ...(options.withRequired === true ? { withRequired: true } : {}) }
        })
    );
    if (options.json === true) {
        printJson(context, features);
        return;
    }
    const changed: Feature | undefined = features.capabilities.find((line: Feature) => line.capability === feature.trim());
    printLine(
        context,
        `${allowed ? 'Liberada' : 'Tirada'} em ${features.company.name}: ${changed === undefined ? feature : lineOf(changed)}`
    );
    if (options.withRequired === true) {
        printNotice(context, 'Os módulos que ela exige também ficaram liberados: confira com `nexo features list <empresa>`.');
    }
}
