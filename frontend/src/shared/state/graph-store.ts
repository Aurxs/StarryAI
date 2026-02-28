import {create} from 'zustand';

import type {
    EdgeSpec,
    GraphSpec,
    NodeInstanceSpec,
    ValidationIssue,
} from '../../entities/workbench/types';

export interface GraphState {
    graph: GraphSpec;
    selectedNodeId: string | null;
    isDirty: boolean;
    validationIssues: ValidationIssue[];
    validationValid: boolean | null;
    validationCheckedAt: number | null;
    setGraphMeta: (graphId: string, version?: string) => void;
    setNodes: (nodes: NodeInstanceSpec[]) => void;
    setEdges: (edges: EdgeSpec[]) => void;
    upsertNode: (node: NodeInstanceSpec) => void;
    patchNode: (
        nodeId: string,
        patch: Partial<Pick<NodeInstanceSpec, 'title' | 'config'>>,
    ) => void;
    removeNode: (nodeId: string) => void;
    selectNode: (nodeId: string | null) => void;
    setValidationResult: (valid: boolean, issues: ValidationIssue[]) => void;
    clearValidation: () => void;
    resetGraph: (graphId?: string) => void;
}

const createDefaultGraph = (graphId = 'graph_phase_e'): GraphSpec => ({
    graph_id: graphId,
    version: '0.1.0',
    nodes: [],
    edges: [],
    metadata: {},
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

export const useGraphStore = create<GraphState>((set) => ({
    ...createInitialState(),
    ...createEmptyValidationState(),
    setGraphMeta: (graphId, version = '0.1.0') =>
        set((state) => ({
            graph: {
                ...state.graph,
                graph_id: graphId.trim() || state.graph.graph_id,
                version: version.trim() || state.graph.version,
            },
            isDirty: true,
            ...createEmptyValidationState(),
        })),
    setNodes: (nodes) =>
        set((state) => ({
            graph: {
                ...state.graph,
                nodes,
            },
            isDirty: true,
            ...createEmptyValidationState(),
        })),
    setEdges: (edges) =>
        set((state) => ({
            graph: {
                ...state.graph,
                edges,
            },
            isDirty: true,
            ...createEmptyValidationState(),
        })),
    upsertNode: (node) =>
        set((state) => {
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

            return {
                graph: {
                    ...state.graph,
                    nodes: nextNodes,
                },
                isDirty: true,
                ...createEmptyValidationState(),
            };
        }),
    patchNode: (nodeId, patch) =>
        set((state) => {
            const normalizedId = nodeId.trim();
            if (!normalizedId) {
                return state;
            }

            const index = state.graph.nodes.findIndex((item) => item.node_id === normalizedId);
            if (index < 0) {
                return state;
            }

            const current = state.graph.nodes[index];
            const nextNodes = [...state.graph.nodes];
            nextNodes[index] = {
                ...current,
                title: typeof patch.title === 'string' ? patch.title : current.title,
                config: patch.config ?? current.config,
            };

            return {
                graph: {
                    ...state.graph,
                    nodes: nextNodes,
                },
                isDirty: true,
                ...createEmptyValidationState(),
            };
        }),
    removeNode: (nodeId) =>
        set((state) => {
            const normalizedId = nodeId.trim();
            if (!normalizedId) {
                return state;
            }

            const nextNodes = state.graph.nodes.filter((node) => node.node_id !== normalizedId);
            const nextEdges = state.graph.edges.filter(
                (edge) => edge.source_node !== normalizedId && edge.target_node !== normalizedId,
            );
            const removed = nextNodes.length !== state.graph.nodes.length;

            return {
                graph: {
                    ...state.graph,
                    nodes: nextNodes,
                    edges: nextEdges,
                },
                selectedNodeId: state.selectedNodeId === normalizedId ? null : state.selectedNodeId,
                isDirty: state.isDirty || removed,
                ...(removed ? createEmptyValidationState() : {}),
            };
        }),
    selectNode: (nodeId) => set(() => ({selectedNodeId: nodeId})),
    setValidationResult: (valid, issues) =>
        set(() => ({
            validationValid: valid,
            validationIssues: issues,
            validationCheckedAt: Date.now(),
        })),
    clearValidation: () => set(() => createEmptyValidationState()),
    resetGraph: (graphId) =>
        set(() => ({
            graph: createDefaultGraph(graphId?.trim() || 'graph_phase_e'),
            selectedNodeId: null,
            isDirty: false,
            ...createEmptyValidationState(),
        })),
}));

export const resetGraphStore = (): void => {
    useGraphStore.setState({
        ...createInitialState(),
        ...createEmptyValidationState(),
    });
};
