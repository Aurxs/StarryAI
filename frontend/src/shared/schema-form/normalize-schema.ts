import type {SecretRef} from '../../entities/workbench/types';

export interface JsonSchemaNode {
    $defs?: Record<string, JsonSchemaNode>;
    $ref?: string;
    anyOf?: JsonSchemaNode[];
    type?: string;
    title?: string;
    description?: string;
    default?: unknown;
    enum?: unknown[];
    properties?: Record<string, JsonSchemaNode>;
    required?: string[];
    items?: JsonSchemaNode;
    minimum?: number;
    maximum?: number;
    minLength?: number;
    maxLength?: number;
    [key: string]: unknown;
}

export interface ResolvedSchemaNode extends JsonSchemaNode {
    nullable: boolean;
}

const SECRET_FIELD_KEY = 'x-starryai-secret';
const SECRET_WIDGET_KEY = 'x-starryai-widget';
const ORDER_KEY = 'x-starryai-order';
const TEXTAREA_WIDGET = 'textarea';

const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const cloneValue = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const isSecretRef = (value: unknown): value is SecretRef => {
    if (!isRecord(value)) {
        return false;
    }
    return value.$kind === 'secret_ref' && typeof value.secret_id === 'string' && value.secret_id.trim().length > 0;
};

export const resolveSchemaNode = (
    schema: JsonSchemaNode,
    rootSchema: JsonSchemaNode = schema,
): ResolvedSchemaNode => {
    if (schema.$ref && schema.$ref.startsWith('#/$defs/')) {
        const key = schema.$ref.slice('#/$defs/'.length);
        const target = rootSchema.$defs?.[key];
        if (target) {
            const resolved = resolveSchemaNode(target, rootSchema);
            return {
                ...resolved,
                title: schema.title ?? resolved.title,
                description: schema.description ?? resolved.description,
                [SECRET_FIELD_KEY]: schema[SECRET_FIELD_KEY] ?? resolved[SECRET_FIELD_KEY],
                [SECRET_WIDGET_KEY]: schema[SECRET_WIDGET_KEY] ?? resolved[SECRET_WIDGET_KEY],
                [ORDER_KEY]: schema[ORDER_KEY] ?? resolved[ORDER_KEY],
            };
        }
    }

    const anyOf = Array.isArray(schema.anyOf) ? schema.anyOf : null;
    if (anyOf) {
        const nonNullVariants = anyOf.filter((item) => item.type !== 'null');
        const nullable = anyOf.length !== nonNullVariants.length;
        if (nonNullVariants.length === 1) {
            const resolved = resolveSchemaNode(nonNullVariants[0], rootSchema);
            return {
                ...resolved,
                nullable,
                title: schema.title ?? resolved.title,
                description: schema.description ?? resolved.description,
                default: schema.default ?? resolved.default,
                [SECRET_FIELD_KEY]: schema[SECRET_FIELD_KEY] ?? resolved[SECRET_FIELD_KEY],
                [SECRET_WIDGET_KEY]: schema[SECRET_WIDGET_KEY] ?? resolved[SECRET_WIDGET_KEY],
                [ORDER_KEY]: schema[ORDER_KEY] ?? resolved[ORDER_KEY],
            };
        }
    }

    return {
        ...schema,
        nullable: false,
    };
};

export const isSecretSchema = (schema: ResolvedSchemaNode): boolean =>
    schema[SECRET_FIELD_KEY] === true || schema[SECRET_WIDGET_KEY] === 'secret';

export const isTextareaSchema = (schema: ResolvedSchemaNode): boolean =>
    schema[SECRET_WIDGET_KEY] === TEXTAREA_WIDGET;

export const getOrderedObjectEntries = (
    schema: JsonSchemaNode,
    rootSchema: JsonSchemaNode = schema,
): Array<[string, ResolvedSchemaNode]> => {
    const resolved = resolveSchemaNode(schema, rootSchema);
    const properties = resolved.properties ?? {};
    return Object.entries(properties)
        .map(([key, value]) => [key, resolveSchemaNode(value, rootSchema)] as [string, ResolvedSchemaNode])
        .sort((left, right) => {
            const leftOrder = Number(left[1][ORDER_KEY] ?? Number.MAX_SAFE_INTEGER);
            const rightOrder = Number(right[1][ORDER_KEY] ?? Number.MAX_SAFE_INTEGER);
            if (leftOrder !== rightOrder) {
                return leftOrder - rightOrder;
            }
            return left[0].localeCompare(right[0]);
        });
};

export const getRequiredFieldSet = (schema: JsonSchemaNode): Set<string> =>
    new Set(Array.isArray(schema.required) ? schema.required : []);

export const applySchemaDefaults = (
    schema: JsonSchemaNode,
    value: Record<string, unknown>,
    rootSchema: JsonSchemaNode = schema,
): Record<string, unknown> => {
    const resolved = resolveSchemaNode(schema, rootSchema);
    const nextValue = cloneValue(value);
    if (resolved.type !== 'object' || !resolved.properties) {
        return nextValue;
    }

    for (const [fieldKey, childSchema] of Object.entries(resolved.properties)) {
        const childResolved = resolveSchemaNode(childSchema, rootSchema);
        const currentValue = nextValue[fieldKey];
        if (currentValue === undefined && childResolved.default !== undefined) {
            nextValue[fieldKey] = cloneValue(childResolved.default);
            continue;
        }
        if (childResolved.type === 'object') {
            const objectValue = isRecord(currentValue) ? currentValue : {};
            const applied = applySchemaDefaults(childSchema, objectValue, rootSchema);
            if (Object.keys(applied).length > 0 || currentValue !== undefined) {
                nextValue[fieldKey] = applied;
            }
        }
    }
    return nextValue;
};

export const findPlaintextSecretPaths = (
    schema: JsonSchemaNode,
    value: unknown,
    rootSchema: JsonSchemaNode = schema,
    path: string[] = [],
): string[] => {
    const resolved = resolveSchemaNode(schema, rootSchema);
    if (isSecretSchema(resolved)) {
        if (value === undefined || value === null || isSecretRef(value)) {
            return [];
        }
        return [path.join('.') || '<root>'];
    }

    if (resolved.type === 'object' && resolved.properties && isRecord(value)) {
        return Object.entries(resolved.properties).flatMap(([fieldKey, childSchema]) =>
            findPlaintextSecretPaths(
                childSchema,
                value[fieldKey],
                rootSchema,
                [...path, fieldKey],
            ),
        );
    }

    return [];
};
