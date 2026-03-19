import {create} from 'zustand';

import type {
    EdgeSpec,
    GraphSpec,
    GraphVariableSpec,
    GraphVariableUsage,
    NodeInstanceSpec,
    ValidationIssue,
} from '../../entities/workbench/types';
import {
    getGraphVariableUsages,
    readDataRegistry,
    renameVariableReferences,
    replaceGraphVariables,
} from '../data-registry';

export interface GraphHistoryEntry {
    id: number;
    label: string;
    at: number;
}

export interface GraphState {
    graph: GraphSpec;
    selectedNodeId: string | null;
    isDirty: boolean;
    canUndo: boolean;
    canRedo: boolean;
    historyEntries: GraphHistoryEntry[];
    validationIssues: ValidationIssue[];
    validationValid: boolean | null;
    validationCheckedAt: number | null;
    _past: GraphCheckpoint[];
    _future: GraphCheckpoint[];
    _historySeed: number;
    setGraphMeta: (graphId: string, version?: string) => void;
    setMetadata: (metadata: Record<string, unknown>) => void;
    setNodes: (nodes: NodeInstanceSpec[]) => void;
    setEdges: (edges: EdgeSpec[]) => void;
    createVariable: (variable: GraphVariableSpec) => boolean;
    updateVariable: (
        variableName: string,
        patch: Partial<Pick<GraphVariableSpec, 'value_kind' | 'initial_value'>>,
    ) => boolean;
    renameVariable: (variableName: string, nextName: string) => boolean;
    deleteVariable: (variableName: string) => boolean;
    getVariableUsages: (variableName?: string | null) => GraphVariableUsage[];
    upsertNode: (node: NodeInstanceSpec) => void;
    patchNode: (
        nodeId: string,
        patch: Partial<Pick<NodeInstanceSpec, 'title' | 'config'>>,
    ) => void;
    removeNode: (nodeId: string) => void;
    selectNode: (nodeId: string | null) => void;
    undo: () => void;
    redo: () => void;
    setValidationResult: (valid: boolean, issues: ValidationIssue[]) => void;
    clearValidation: () => void;
    markClean: () => void;
    resetGraph: (graphId?: string) => void;
    replaceGraph: (graph: GraphSpec) => void;
}

interface GraphCheckpoint {
    graph: GraphSpec;
    label: string;
}

interface InternalGraphState extends GraphState {
    _past: GraphCheckpoint[];
    _future: GraphCheckpoint[];
    _historySeed: number;
}

const HISTORY_LIMIT = 100;
const DEFAULT_GRAPH_ID = 'graph_new';
const HISTORY_LABELS = {
    graphMetaUpdated: 'graphMetaUpdated',
    nodesUpdated: 'nodesUpdated',
    edgesUpdated: 'edgesUpdated',
    variableCreated: 'variableCreated',
    constantCreated: 'constantCreated',
    variableUpdated: 'variableUpdated',
    variableRenamed: 'variableRenamed',
    variableDeleted: 'variableDeleted',
    nodeUpdated: 'nodeUpdated',
    nodeCreated: 'nodeCreated',
    nodeConfigUpdated: 'nodeConfigUpdated',
    nodeDeleted: 'nodeDeleted',
} as const;

const createDefaultGraph = (graphId = DEFAULT_GRAPH_ID): GraphSpec => ({
    graph_id: graphId,
    version: '0.1.0',
    nodes: [],
    edges: [],
    metadata: {
        data_registry: {
            variables: [],
        },
    },
});

const createInitialState = (): Pick<GraphState, 'graph' | 'selectedNodeId' | 'isDirty'> => ({
    graph: createDefaultGraph(),
    selectedNodeId: null,
    isDirty: false,
});

const createEmptyValidationState = (): Pick<
    GraphState,
    'validationIssues' | 'validationValid' | 'validationCheckedAt'
> => ({
    validationIssues: [],
    validationValid: null,
    validationCheckedAt: null,
});

const createEmptyHistoryState = (): Pick<
    InternalGraphState,
    'canUndo' | 'canRedo' | 'historyEntries' | '_past' | '_future' | '_historySeed'
> => ({
    canUndo: false,
    canRedo: false,
    historyEntries: [],
    _past: [],
    _future: [],
    _historySeed: 0,
});

const cloneGraph = (graph: GraphSpec): GraphSpec => JSON.parse(JSON.stringify(graph)) as GraphSpec;

const sameGraph = (left: GraphSpec, right: GraphSpec): boolean => JSON.stringify(left) === JSON.stringify(right);

const sanitizeSelectedNode = (graph: GraphSpec, selectedNodeId: string | null): string | null => {
    if (!selectedNodeId) {
        return null;
    }
    return graph.nodes.some((node) => node.node_id === selectedNodeId) ? selectedNodeId : null;
};

const trimToLimit = <T>(items: T[]): T[] =>
    items.length > HISTORY_LIMIT ? items.slice(items.length - HISTORY_LIMIT) : items;

const appendHistoryEntry = (state: InternalGraphState, label: string): Pick<InternalGraphState, 'historyEntries' | '_historySeed'> => {
    const nextSeed = state._historySeed + 1;
    const nextEntry: GraphHistoryEntry = {
        id: nextSeed,
        label,
        at: Date.now(),
    };
    return {
        _historySeed: nextSeed,
        historyEntries: trimToLimit([...state.historyEntries, nextEntry]),
    };
};

const commitGraphUpdate = (
    state: InternalGraphState,
    nextGraph: GraphSpec,
    label: string,
    selectedNodeId?: string | null,
): Partial<InternalGraphState> => {
    if (sameGraph(state.graph, nextGraph)) {
        return state;
    }
    const nextPast = trimToLimit([
        ...state._past,
        {
            graph: cloneGraph(state.graph),
            label,
        },
    ]);
    return {
        graph: nextGraph,
        selectedNodeId: sanitizeSelectedNode(nextGraph, selectedNodeId ?? state.selectedNodeId),
        isDirty: true,
        canUndo: nextPast.length > 0,
        canRedo: false,
        _past: nextPast,
        _future: [],
        ...appendHistoryEntry(state, label),
        ...createEmptyValidationState(),
    };
};

export const useGraphStore = create<GraphState>((set, get) => ({
    ...createInitialState(),
    ...createEmptyHistoryState(),
    ...createEmptyValidationState(),
    setGraphMeta: (graphId, version = '0.1.0') =>
        set((current) => {
            const state = current as InternalGraphState;
            const nextGraph = {
                ...state.graph,
                graph_id: graphId.trim() || state.graph.graph_id,
                version: version.trim() || state.graph.version,
            };
            return commitGraphUpdate(state, nextGraph, HISTORY_LABELS.graphMetaUpdated);
        }),
    setMetadata: (metadata) =>
        set((current) => {
            const state = current as InternalGraphState;
            const nextGraph = {
                ...state.graph,
                metadata,
            };
            if (sameGraph(state.graph, nextGraph)) {
                return state;
            }
            return {
                graph: nextGraph,
                selectedNodeId: sanitizeSelectedNode(nextGraph, state.selectedNodeId),
                isDirty: true,
            };
        }),
    setNodes: (nodes) =>
        set((current) => {
            const state = current as InternalGraphState;
            const nextGraph = {
                ...state.graph,
                nodes,
            };
            return commitGraphUpdate(state, nextGraph, HISTORY_LABELS.nodesUpdated);
        }),
    setEdges: (edges) =>
        set((current) => {
            const state = current as InternalGraphState;
            const nextGraph = {
                ...state.graph,
                edges,
            };
            return commitGraphUpdate(state, nextGraph, HISTORY_LABELS.edgesUpdated);
        }),
    createVariable: (variable) => {
        const normalizedName = variable.name.trim();
        let changed = false;
        set((current) => {
            const state = current as InternalGraphState;
            if (!normalizedName) {
                return state;
            }
            const variables = readDataRegistry(state.graph.metadata).variables;
            if (variables.some((item) => item.name === normalizedName)) {
                return state;
            }
            const nextGraph = {
                ...state.graph,
                metadata: replaceGraphVariables(state.graph.metadata, [
                    ...variables,
                    {
                        ...variable,
                        name: normalizedName,
                        is_constant: Boolean(variable.is_constant),
                    },
                ]),
            };
            changed = !sameGraph(state.graph, nextGraph);
            return commitGraphUpdate(
                state,
                nextGraph,
                Boolean(variable.is_constant) ? HISTORY_LABELS.constantCreated : HISTORY_LABELS.variableCreated,
            );
        });
        return changed;
    },
    updateVariable: (variableName, patch) => {
        const normalizedName = variableName.trim();
        let changed = false;
        set((current) => {
            const state = current as InternalGraphState;
            if (!normalizedName) {
                return state;
            }
            const variables = readDataRegistry(state.graph.metadata).variables;
            const index = variables.findIndex((item) => item.name === normalizedName);
            if (index < 0) {
                return state;
            }
            const currentVariable = variables[index];
            if (currentVariable.is_constant) {
                return state;
            }
            const nextVariables = [...variables];
            nextVariables[index] = {
                ...currentVariable,
                value_kind: patch.value_kind ?? currentVariable.value_kind,
                initial_value:
                    patch.initial_value !== undefined
                        ? patch.initial_value
                        : currentVariable.initial_value,
            };
            const nextGraph = {
                ...state.graph,
                metadata: replaceGraphVariables(state.graph.metadata, nextVariables),
            };
            changed = !sameGraph(state.graph, nextGraph);
            return commitGraphUpdate(state, nextGraph, HISTORY_LABELS.variableUpdated);
        });
        return changed;
    },
    renameVariable: (variableName, nextName) => {
        const normalizedName = variableName.trim();
        const normalizedNextName = nextName.trim();
        let changed = false;
        set((current) => {
            const state = current as InternalGraphState;
            if (!normalizedName || !normalizedNextName || normalizedName === normalizedNextName) {
                return state;
            }
            const variables = readDataRegistry(state.graph.metadata).variables;
            const index = variables.findIndex((item) => item.name === normalizedName);
            if (index < 0 || variables[index]?.is_constant || variables.some((item) => item.name === normalizedNextName)) {
                return state;
            }
            const nextVariables = [...variables];
            nextVariables[index] = {
                ...nextVariables[index],
                name: normalizedNextName,
            };
            const nextGraph = {
                ...state.graph,
                nodes: renameVariableReferences(state.graph.nodes, normalizedName, normalizedNextName),
                metadata: replaceGraphVariables(state.graph.metadata, nextVariables),
            };
            changed = !sameGraph(state.graph, nextGraph);
            return commitGraphUpdate(state, nextGraph, HISTORY_LABELS.variableRenamed);
        });
        return changed;
    },
    deleteVariable: (variableName) => {
        const normalizedName = variableName.trim();
        let changed = false;
        set((current) => {
            const state = current as InternalGraphState;
            if (!normalizedName) {
                return state;
            }
            const variables = readDataRegistry(state.graph.metadata).variables;
            if (variables.some((item) => item.name === normalizedName && item.is_constant)) {
                return state;
            }
            const nextVariables = variables.filter((item) => item.name !== normalizedName);
            if (nextVariables.length === variables.length) {
                return state;
            }
            const nextGraph = {
                ...state.graph,
                metadata: replaceGraphVariables(state.graph.metadata, nextVariables),
            };
            changed = !sameGraph(state.graph, nextGraph);
            return commitGraphUpdate(state, nextGraph, HISTORY_LABELS.variableDeleted);
        });
        return changed;
    },
    getVariableUsages: (variableName) => getGraphVariableUsages(get().graph, variableName),
    upsertNode: (node) =>
        set((current) => {
            const state = current as InternalGraphState;
            const normalizedId = node.node_id.trim();
            if (!normalizedId) {
                return state;
            }
            const existingIndex = state.graph.nodes.findIndex((item) => item.node_id === normalizedId);
            const nextNodes = [...state.graph.nodes];
            if (existingIndex >= 0) {
                nextNodes[existingIndex] = {
                    ...node,
                    node_id: normalizedId,
                };
            } else {
                nextNodes.push({
                    ...node,
                    node_id: normalizedId,
                });
            }
            const nextGraph = {
                ...state.graph,
                nodes: nextNodes,
            };
            return commitGraphUpdate(
                state,
                nextGraph,
                existingIndex >= 0 ? HISTORY_LABELS.nodeUpdated : HISTORY_LABELS.nodeCreated,
            );
        }),
    patchNode: (nodeId, patch) =>
        set((current) => {
            const state = current as InternalGraphState;
            const normalizedId = nodeId.trim();
            if (!normalizedId) {
                return state;
            }
            const index = state.graph.nodes.findIndex((item) => item.node_id === normalizedId);
            if (index < 0) {
                return state;
            }
            const currentNode = state.graph.nodes[index];
            const nextNodes = [...state.graph.nodes];
            nextNodes[index] = {
                ...currentNode,
                title: typeof patch.title === 'string' ? patch.title : currentNode.title,
                config: patch.config ?? currentNode.config,
            };
            const nextGraph = {
                ...state.graph,
                nodes: nextNodes,
            };
            return commitGraphUpdate(state, nextGraph, HISTORY_LABELS.nodeConfigUpdated);
        }),
    removeNode: (nodeId) =>
        set((current) => {
            const state = current as InternalGraphState;
            const normalizedId = nodeId.trim();
            if (!normalizedId) {
                return state;
            }
            const nextNodes = state.graph.nodes.filter((node) => node.node_id !== normalizedId);
            if (nextNodes.length === state.graph.nodes.length) {
                return state;
            }
            const nextEdges = state.graph.edges.filter(
                (edge) => edge.source_node !== normalizedId && edge.target_node !== normalizedId,
            );
            const nextGraph = {
                ...state.graph,
                nodes: nextNodes,
                edges: nextEdges,
            };
            return commitGraphUpdate(state, nextGraph, HISTORY_LABELS.nodeDeleted);
        }),
    selectNode: (nodeId) => set(() => ({selectedNodeId: nodeId})),
    undo: () =>
        set((current) => {
            const state = current as InternalGraphState;
            if (state._past.length === 0) {
                return state;
            }
            const nextPast = [...state._past];
            const checkpoint = nextPast.pop();
            if (!checkpoint) {
                return state;
            }
            const nextFuture = trimToLimit([
                ...state._future,
                {
                    graph: cloneGraph(state.graph),
                    label: checkpoint.label,
                },
            ]);
            return {
                graph: cloneGraph(checkpoint.graph),
                selectedNodeId: sanitizeSelectedNode(checkpoint.graph, state.selectedNodeId),
                isDirty: true,
                canUndo: nextPast.length > 0,
                canRedo: nextFuture.length > 0,
                _past: nextPast,
                _future: nextFuture,
                ...appendHistoryEntry(state, `undo:${checkpoint.label}`),
                ...createEmptyValidationState(),
            };
        }),
    redo: () =>
        set((current) => {
            const state = current as InternalGraphState;
            if (state._future.length === 0) {
                return state;
            }
            const nextFuture = [...state._future];
            const checkpoint = nextFuture.pop();
            if (!checkpoint) {
                return state;
            }
            const nextPast = trimToLimit([
                ...state._past,
                {
                    graph: cloneGraph(state.graph),
                    label: checkpoint.label,
                },
            ]);
            return {
                graph: cloneGraph(checkpoint.graph),
                selectedNodeId: sanitizeSelectedNode(checkpoint.graph, state.selectedNodeId),
                isDirty: true,
                canUndo: nextPast.length > 0,
                canRedo: nextFuture.length > 0,
                _past: nextPast,
                _future: nextFuture,
                ...appendHistoryEntry(state, `redo:${checkpoint.label}`),
                ...createEmptyValidationState(),
            };
        }),
    setValidationResult: (valid, issues) =>
        set(() => ({
            validationValid: valid,
            validationIssues: issues,
            validationCheckedAt: Date.now(),
        })),
    clearValidation: () => set(() => createEmptyValidationState()),
    markClean: () => set(() => ({isDirty: false})),
    resetGraph: (graphId) =>
        set(() => ({
            graph: createDefaultGraph(graphId?.trim() || DEFAULT_GRAPH_ID),
            selectedNodeId: null,
            isDirty: false,
            ...createEmptyHistoryState(),
            ...createEmptyValidationState(),
        })),
    replaceGraph: (graph) =>
        set((current) => ({
            graph: cloneGraph(graph),
            selectedNodeId: sanitizeSelectedNode(graph, current.selectedNodeId),
            isDirty: false,
            ...createEmptyHistoryState(),
            ...createEmptyValidationState(),
        })),
}));

export const resetGraphStore = (): void => {
    useGraphStore.setState({
        ...createInitialState(),
        ...createEmptyHistoryState(),
        ...createEmptyValidationState(),
    });
};
