import type {
    GraphDataRegistry,
    GraphMetadata,
    GraphSpec,
    GraphVariableSpec,
    GraphVariableUsage,
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

const normalizeVariableName = (value: string): string => value.trim();

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
        name: normalizeVariableName(variable.name),
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

export const replaceGraphVariables = (
    metadata: GraphMetadata | null | undefined,
    variables: GraphVariableSpec[],
): GraphMetadata => ({
    ...(metadata ?? {}),
    data_registry: {
        variables: variables.map((variable) => ({
            ...variable,
            name: normalizeVariableName(variable.name),
        })),
    },
});

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
): boolean => readDataRegistry(metadata).variables.some((item) => item.name === normalizeVariableName(preferredName));

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

const collectNodeVariableUsages = (node: NodeInstanceSpec): GraphVariableUsage[] => {
    const usages: GraphVariableUsage[] = [];
    const pushUsage = (fieldName: GraphVariableUsage['field_name'], variableName: unknown) => {
        if (typeof variableName !== 'string' || !normalizeVariableName(variableName)) {
            return;
        }
        usages.push({
            node_id: node.node_id,
            node_title: node.title,
            node_type: node.type_name,
            field_name: fieldName,
        });
    };

    if (isGenericDataNodeType(node.type_name)) {
        pushUsage('variable_name', node.config.variable_name);
    }
    if (isDataWriterType(node.type_name)) {
        pushUsage('target_variable_name', node.config.target_variable_name);
        if (node.config.operand_mode === 'variable') {
            pushUsage('operand_variable_name', node.config.operand_variable_name);
        }
    }
    return usages;
};

export const getGraphVariableUsages = (
    graph: Pick<GraphSpec, 'nodes'>,
    variableName?: string | null,
): GraphVariableUsage[] => {
    const normalizedVariableName = typeof variableName === 'string' ? normalizeVariableName(variableName) : '';
    return graph.nodes.flatMap((node) =>
        collectNodeVariableUsages(node).filter((usage) => {
            if (!normalizedVariableName) {
                return true;
            }
            const rawValue = node.config[usage.field_name];
            return typeof rawValue === 'string' && normalizeVariableName(rawValue) === normalizedVariableName;
        }),
    );
};

export const renameVariableReferences = (
    nodes: NodeInstanceSpec[],
    currentName: string,
    nextName: string,
): NodeInstanceSpec[] => {
    const from = normalizeVariableName(currentName);
    const to = normalizeVariableName(nextName);
    if (!from || !to || from === to) {
        return nodes;
    }
    return nodes.map((node) => {
        let changed = false;
        const nextConfig = {...node.config};
        if (isGenericDataNodeType(node.type_name) && nextConfig.variable_name === from) {
            nextConfig.variable_name = to;
            changed = true;
        }
        if (isDataWriterType(node.type_name) && nextConfig.target_variable_name === from) {
            nextConfig.target_variable_name = to;
            changed = true;
        }
        if (
            isDataWriterType(node.type_name) &&
            nextConfig.operand_mode === 'variable' &&
            nextConfig.operand_variable_name === from
        ) {
            nextConfig.operand_variable_name = to;
            changed = true;
        }
        if (!changed) {
            return node;
        }
        return {
            ...node,
            config: nextConfig,
        };
    });
};
