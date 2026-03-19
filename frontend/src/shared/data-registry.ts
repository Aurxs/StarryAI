import type {
    GraphDataRegistry,
    GraphMetadata,
    GraphVariableSpec,
    GraphVariableValueKind,
    NodeInstanceSpec,
} from '../entities/workbench/types';

export const GRAPH_VARIABLE_VALUE_KINDS: GraphVariableValueKind[] = [
    'scalar.int',
    'scalar.float',
    'scalar.string',
    'json.list',
    'json.dict',
    'json.any',
];

export const createEmptyDataRegistry = (): GraphDataRegistry => ({
    variables: [],
});

export const ensureGraphMetadata = (metadata?: GraphMetadata | null): GraphMetadata => ({
    ...(metadata ?? {}),
    data_registry: readDataRegistry(metadata),
});

export const readDataRegistry = (metadata?: GraphMetadata | null): GraphDataRegistry => {
    const registry = metadata?.data_registry;
    if (!registry || !Array.isArray(registry.variables)) {
        return createEmptyDataRegistry();
    }
    return {
        variables: registry.variables
            .filter(
                (item): item is GraphVariableSpec =>
                    Boolean(item)
                    && typeof item.name === 'string'
                    && typeof item.value_kind === 'string',
            )
            .map((item) => ({
                name: item.name.trim(),
                value_kind: item.value_kind,
                initial_value: item.initial_value,
            })),
    };
};

export const buildGraphVariableIndex = (metadata?: GraphMetadata | null): Map<string, GraphVariableSpec> => {
    const index = new Map<string, GraphVariableSpec>();
    for (const variable of readDataRegistry(metadata).variables) {
        index.set(variable.name, variable);
    }
    return index;
};

export const upsertGraphVariable = (
    metadata: GraphMetadata | null | undefined,
    variable: GraphVariableSpec,
): GraphMetadata => {
    const registry = readDataRegistry(metadata);
    const normalizedVariable = {
        ...variable,
        name: variable.name.trim(),
    };
    const existingIndex = registry.variables.findIndex((item) => item.name === normalizedVariable.name);
    const nextVariables = [...registry.variables];
    if (existingIndex >= 0) {
        nextVariables[existingIndex] = normalizedVariable;
    } else {
        nextVariables.push(normalizedVariable);
    }
    return {
        ...(metadata ?? {}),
        data_registry: {
            variables: nextVariables,
        },
    };
};

export const findGraphVariable = (
    metadata: GraphMetadata | null | undefined,
    variableName: string | null | undefined,
): GraphVariableSpec | null => {
    if (!variableName) {
        return null;
    }
    return buildGraphVariableIndex(metadata).get(variableName) ?? null;
};

export const isDuplicateGraphVariableName = (
    metadata: GraphMetadata | null | undefined,
    preferredName: string,
): boolean => readDataRegistry(metadata).variables.some((item) => item.name === preferredName.trim());

export const getVariableSchema = (valueKind: string | null | undefined): string => {
    switch (valueKind) {
        case 'scalar.int':
        case 'scalar.float':
        case 'scalar.string':
        case 'json.list':
        case 'json.dict':
        case 'json.any':
            return valueKind;
        default:
            return 'any';
    }
};

export const isGenericDataNodeType = (typeName: string): boolean => typeName === 'data.ref';

export const isDataWriterType = (typeName: string): boolean => typeName === 'data.writer';

export const isDataRequesterType = (typeName: string): boolean => typeName === 'data.requester';

export const isVisibleDataLibraryType = (typeName: string): boolean =>
    typeName === 'data.ref' || typeName === 'data.writer' || typeName === 'data.requester';

export const getNodeBoundVariable = (
    metadata: GraphMetadata | null | undefined,
    node: Pick<NodeInstanceSpec, 'type_name' | 'config'>,
): GraphVariableSpec | null => {
    if (!isGenericDataNodeType(node.type_name)) {
        return null;
    }
    const variableName = typeof node.config.variable_name === 'string' ? node.config.variable_name : '';
    return findGraphVariable(metadata, variableName);
};

export const getValueKindLabel = (valueKind: string): string => {
    switch (valueKind) {
        case 'scalar.int':
            return 'int';
        case 'scalar.float':
            return 'float';
        case 'scalar.string':
            return 'string';
        case 'json.list':
            return 'list';
        case 'json.dict':
            return 'dict';
        case 'json.any':
            return 'json';
        default:
            return 'any';
    }
};
