import {useCallback, useEffect, useMemo, useState, type CSSProperties, type DragEvent} from 'react';
import ReactFlow, {
    Background,
    Controls,
    Handle,
    MarkerType,
    MiniMap,
    Position,
    ReactFlowProvider,
    applyEdgeChanges,
    applyNodeChanges,
    type Connection,
    type Edge,
    type Node,
    type NodeChange,
    type NodeProps,
    type OnEdgesChange,
    type OnNodesChange,
    type XYPosition,
    useEdgesState,
    useNodesState,
    useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';

import type {EdgeSpec, NodeInstanceSpec, NodeSpec} from '../../entities/workbench/types';
import {apiClient} from '../../shared/api/client';
import {useGraphStore} from '../../shared/state/graph-store';
import {
    SOURCE_HANDLE_PREFIX,
    TARGET_HANDLE_PREFIX,
    buildEdgeId,
    canBindTargetPort,
    deriveValidationTargets,
    edgeToSpec,
} from './utils';

interface WorkflowNodeData {
    nodeId: string;
    title: string;
    spec: NodeSpec;
}

const emptyPorts: NodeSpec['inputs'] = [];

const editorShellStyle: CSSProperties = {
    marginTop: 12,
    borderRadius: 10,
    border: '1px solid rgba(31, 41, 51, 0.16)',
    overflow: 'hidden',
};

const toolbarStyle: CSSProperties = {
    padding: 10,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    borderBottom: '1px solid rgba(31, 41, 51, 0.14)',
    background: 'rgba(255,255,255,0.7)',
};

const paletteChipStyle: CSSProperties = {
    border: '1px solid rgba(31, 41, 51, 0.2)',
    borderRadius: 999,
    padding: '4px 10px',
    fontSize: 12,
    cursor: 'grab',
    background: '#ffffff',
};

const paletteButtonStyle: CSSProperties = {
    border: '1px solid rgba(31, 41, 51, 0.2)',
    borderRadius: 8,
    padding: '4px 8px',
    fontSize: 12,
    cursor: 'pointer',
    background: '#ffffff',
};

const workflowNodeStyle: CSSProperties = {
    minWidth: 160,
    border: '1px solid rgba(31, 41, 51, 0.35)',
    borderRadius: 10,
    padding: '8px 10px',
    background: '#ffffff',
    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.08)',
};

const getPortTop = (index: number, total: number): string =>
    `${Math.round(((index + 1) * 100) / (total + 1))}%`;

const fallbackNodeTypes: NodeSpec[] = [
    {
        type_name: 'mock.input',
        version: '0.1.0',
        mode: 'async',
        inputs: [],
        outputs: [
            {
                name: 'text',
                frame_schema: 'text.final',
                is_stream: false,
                required: true,
                description: '',
            },
        ],
        sync_config: null,
        config_schema: {},
        description: 'Fallback node type',
    },
    {
        type_name: 'mock.output',
        version: '0.1.0',
        mode: 'async',
        inputs: [
            {
                name: 'in',
                frame_schema: 'any',
                is_stream: false,
                required: true,
                description: '',
            },
        ],
        outputs: [],
        sync_config: null,
        config_schema: {},
        description: 'Fallback node type',
    },
];

const nextNodeId = (nodes: NodeInstanceSpec[]): string => {
    let index = nodes.length + 1;
    while (nodes.some((node) => node.node_id === `n${index}`)) {
        index += 1;
    }
    return `n${index}`;
};

const toRfEdge = (edge: EdgeSpec, highlighted = false): Edge => ({
    id: buildEdgeId(edge.source_node, edge.source_port, edge.target_node, edge.target_port),
    source: edge.source_node,
    sourceHandle: `${SOURCE_HANDLE_PREFIX}${edge.source_port}`,
    target: edge.target_node,
    targetHandle: `${TARGET_HANDLE_PREFIX}${edge.target_port}`,
    markerEnd: {
        type: MarkerType.ArrowClosed,
    },
    style: highlighted
        ? {
            stroke: '#be123c',
            strokeWidth: 2,
        }
        : undefined,
});

const WorkflowNode = ({data}: NodeProps<WorkflowNodeData>) => {
    const inputs = data.spec.inputs ?? emptyPorts;
    const outputs = data.spec.outputs ?? emptyPorts;

    return (
        <div style={workflowNodeStyle}>
            <strong>{data.title}</strong>
            <div style={{fontSize: 11, opacity: 0.76}}>{data.spec.type_name}</div>

            {inputs.map((port, index) => (
                <Handle
                    key={`in-${port.name}`}
                    id={`${TARGET_HANDLE_PREFIX}${port.name}`}
                    type="target"
                    position={Position.Left}
                    style={{top: getPortTop(index, inputs.length), width: 8, height: 8}}
                />
            ))}
            {outputs.map((port, index) => (
                <Handle
                    key={`out-${port.name}`}
                    id={`${SOURCE_HANDLE_PREFIX}${port.name}`}
                    type="source"
                    position={Position.Right}
                    style={{top: getPortTop(index, outputs.length), width: 8, height: 8}}
                />
            ))}
        </div>
    );
};

const nodeTypes = {workflowNode: WorkflowNode};

const GraphEditorInner = () => {
    const graph = useGraphStore((state) => state.graph);
    const setEdgesInStore = useGraphStore((state) => state.setEdges);
    const upsertNode = useGraphStore((state) => state.upsertNode);
    const removeNode = useGraphStore((state) => state.removeNode);
    const selectNode = useGraphStore((state) => state.selectNode);
    const validationIssues = useGraphStore((state) => state.validationIssues);

    const reactFlow = useReactFlow();

    const [catalog, setCatalog] = useState<NodeSpec[]>(fallbackNodeTypes);
    const [catalogLoading, setCatalogLoading] = useState(false);
    const [catalogError, setCatalogError] = useState<string | null>(null);
    const [editorMessage, setEditorMessage] = useState<string | null>(null);
    const [positions, setPositions] = useState<Record<string, XYPosition>>({});

    const [rfNodes, setRfNodes] = useNodesState<WorkflowNodeData>([]);
    const [rfEdges, setRfEdges] = useEdgesState([]);

    const catalogByType = useMemo(() => {
        const index = new Map<string, NodeSpec>();
        for (const item of catalog) {
            index.set(item.type_name, item);
        }
        return index;
    }, [catalog]);

    const validationTargets = useMemo(
        () => deriveValidationTargets(graph, validationIssues),
        [graph, validationIssues],
    );

    useEffect(() => {
        let cancelled = false;
        const loadCatalog = async () => {
            setCatalogLoading(true);
            setCatalogError(null);
            try {
                const payload = await apiClient.listNodeTypes();
                if (!cancelled && payload.items.length > 0) {
                    setCatalog(payload.items);
                }
            } catch (error) {
                if (!cancelled) {
                    setCatalogError(`node types unavailable: ${String(error)}`);
                }
            } finally {
                if (!cancelled) {
                    setCatalogLoading(false);
                }
            }
        };
        void loadCatalog();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        setRfNodes(
            graph.nodes.map((node, index) => {
                const spec = catalogByType.get(node.type_name) ?? fallbackNodeTypes[0];
                const pos = positions[node.node_id] ?? {x: 80 + index * 40, y: 80 + index * 24};
                const highlighted = validationTargets.nodeIds.has(node.node_id);
                return {
                    id: node.node_id,
                    type: 'workflowNode',
                    position: pos,
                    style: highlighted
                        ? {
                            border: '2px solid #be123c',
                            boxShadow: '0 0 0 2px rgba(190, 18, 60, 0.15)',
                        }
                        : undefined,
                    data: {
                        nodeId: node.node_id,
                        title: node.title || node.type_name,
                        spec,
                    },
                };
            }),
        );
        setRfEdges(
            graph.edges.map((edge) =>
                toRfEdge(
                    edge,
                    validationTargets.edgeIds.has(
                        buildEdgeId(edge.source_node, edge.source_port, edge.target_node, edge.target_port),
                    ),
                ),
            ),
        );
    }, [catalogByType, graph.edges, graph.nodes, positions, setRfEdges, setRfNodes, validationTargets]);

    const syncEdgesToStore = useCallback(
        (edges: Edge[]) => {
            const specs = edges
                .map((edge) => edgeToSpec(edge))
                .filter((item): item is EdgeSpec => item !== null);
            setEdgesInStore(specs);
        },
        [setEdgesInStore],
    );

    const handleNodesChange = useCallback<OnNodesChange>(
        (changes: NodeChange[]) => {
            setRfNodes((current) => applyNodeChanges(changes, current));
        },
        [setRfNodes],
    );

    const handleEdgesChange = useCallback<OnEdgesChange>(
        (changes) => {
            setRfEdges((current) => {
                const next = applyEdgeChanges(changes, current);
                syncEdgesToStore(next);
                return next;
            });
        },
        [setRfEdges, syncEdgesToStore],
    );

    const addNodeAt = useCallback(
        (typeName: string, position?: XYPosition) => {
            const spec = catalogByType.get(typeName);
            if (!spec) {
                setEditorMessage(`unknown node type: ${typeName}`);
                return;
            }
            const nodeId = nextNodeId(graph.nodes);
            upsertNode({
                node_id: nodeId,
                type_name: spec.type_name,
                title: spec.type_name,
                config: {},
            });
            setPositions((current) => ({
                ...current,
                [nodeId]: position ?? {x: 120, y: 120},
            }));
            setEditorMessage(null);
        },
        [catalogByType, graph.nodes, upsertNode],
    );

    const onConnect = useCallback(
        (connection: Connection) => {
            if (!connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) {
                setEditorMessage('invalid connection: source/target handle is missing');
                return;
            }
            if (!canBindTargetPort(rfEdges, connection.target, connection.targetHandle)) {
                setEditorMessage('duplicate target port binding is blocked');
                return;
            }

            const sourcePort = connection.sourceHandle.slice(SOURCE_HANDLE_PREFIX.length);
            const targetPort = connection.targetHandle.slice(TARGET_HANDLE_PREFIX.length);
            const edgeId = buildEdgeId(connection.source, sourcePort, connection.target, targetPort);
            const nextEdge: Edge = {
                id: edgeId,
                source: connection.source,
                sourceHandle: connection.sourceHandle,
                target: connection.target,
                targetHandle: connection.targetHandle,
                markerEnd: {type: MarkerType.ArrowClosed},
            };

            setRfEdges((current) => {
                const next = [...current, nextEdge];
                syncEdgesToStore(next);
                return next;
            });
            setEditorMessage(null);
        },
        [rfEdges, setRfEdges, syncEdgesToStore],
    );

    const onNodesDelete = useCallback(
        (nodes: Node[]) => {
            for (const node of nodes) {
                removeNode(node.id);
            }
            setPositions((current) => {
                const next = {...current};
                for (const node of nodes) {
                    delete next[node.id];
                }
                return next;
            });
        },
        [removeNode],
    );

    const onNodeDragStop = useCallback((_event: unknown, node: Node) => {
        setPositions((current) => ({
            ...current,
            [node.id]: node.position,
        }));
    }, []);

    const onNodeClick = useCallback(
        (_event: unknown, node: Node) => {
            selectNode(node.id);
        },
        [selectNode],
    );

    const onDropCanvas = useCallback(
        (event: DragEvent<HTMLDivElement>) => {
            event.preventDefault();
            const typeName = event.dataTransfer.getData('application/x-starry-node-type');
            if (!typeName) {
                return;
            }
            const position = reactFlow.screenToFlowPosition({
                x: event.clientX,
                y: event.clientY,
            });
            addNodeAt(typeName, position);
        },
        [addNodeAt, reactFlow],
    );

    const onDragOverCanvas = useCallback((event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
    }, []);

    return (
        <section style={editorShellStyle} data-testid="graph-editor-shell">
            <div style={toolbarStyle}>
                <strong style={{marginRight: 8}}>Node Palette</strong>
                {catalog.map((nodeType) => (
                    <div key={nodeType.type_name} style={{display: 'flex', alignItems: 'center', gap: 6}}>
            <span
                draggable
                onDragStart={(event) => {
                    event.dataTransfer.setData('application/x-starry-node-type', nodeType.type_name);
                }}
                style={paletteChipStyle}
                title={nodeType.description || nodeType.type_name}
            >
              {nodeType.type_name}
            </span>
                        <button
                            type="button"
                            style={paletteButtonStyle}
                            onClick={() => addNodeAt(nodeType.type_name)}
                        >
                            Add
                        </button>
                    </div>
                ))}
                <span style={{marginLeft: 'auto', fontSize: 12, opacity: 0.75}} data-testid="graph-editor-meta">
          nodes={graph.nodes.length}, edges={graph.edges.length}
        </span>
            </div>

            <div style={{height: 360}} onDrop={onDropCanvas} onDragOver={onDragOverCanvas}>
                <ReactFlow
                    nodes={rfNodes}
                    edges={rfEdges}
                    nodeTypes={nodeTypes}
                    onNodesChange={handleNodesChange}
                    onEdgesChange={handleEdgesChange}
                    onConnect={onConnect}
                    onNodesDelete={onNodesDelete}
                    onNodeDragStop={onNodeDragStop}
                    onNodeClick={onNodeClick}
                    fitView
                    fitViewOptions={{padding: 0.2}}
                >
                    <Background/>
                    <MiniMap/>
                    <Controls/>
                </ReactFlow>
            </div>

            <div style={{padding: 8, fontSize: 12}}>
                {catalogLoading && <span data-testid="graph-editor-status">Loading node catalog...</span>}
                {!catalogLoading && catalogError && (
                    <span data-testid="graph-editor-status">Catalog fallback active: {catalogError}</span>
                )}
                {!catalogLoading && !catalogError && (
                    <span data-testid="graph-editor-status">Catalog ready ({catalog.length} types)</span>
                )}
                {editorMessage && <span style={{marginLeft: 12, color: '#9f1239'}}>{editorMessage}</span>}
            </div>
        </section>
    );
};

export const GraphEditor = () => (
    <ReactFlowProvider>
        <GraphEditorInner/>
    </ReactFlowProvider>
);
