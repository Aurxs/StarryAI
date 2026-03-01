import {useCallback, useEffect, useMemo, useState, type CSSProperties, type DragEvent} from 'react';
import {useTranslation} from 'react-i18next';
import ReactFlow, {
    Background,
    BackgroundVariant,
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

import type {EdgeSpec, NodeInstanceSpec, NodeSpec, PortSpec} from '../../entities/workbench/types';
import {apiClient} from '../../shared/api/client';
import {useGraphStore} from '../../shared/state/graph-store';
import {useUiStore} from '../../shared/state/ui-store';
import {
    SOURCE_HANDLE_PREFIX,
    TARGET_HANDLE_PREFIX,
    buildEdgeId,
    buildSimpleAutoLayout,
    canBindTargetPort,
    deriveValidationTargets,
    edgeToSpec,
    getSchemaColor,
    isSchemaCompatible,
    simplifyFrameSchema,
} from './utils';

interface WorkflowNodeData {
    nodeId: string;
    title: string;
    spec: NodeSpec;
    onDeleteNode: (nodeId: string) => void;
}

const EMPTY_PORTS: NodeSpec['inputs'] = [];
const ZOOM_PRESETS = [0.5, 0.7, 1, 1.2, 1.5];
const ZOOM_BAR_HEIGHT = 36;
const ZOOM_BAR_ICON_WIDTH = 30;
const ZOOM_BAR_RATIO_WIDTH = 72;
const ZOOM_BAR_WIDTH = ZOOM_BAR_ICON_WIDTH * 2 + ZOOM_BAR_RATIO_WIDTH;
const MINIMAP_WIDTH = ZOOM_BAR_WIDTH;
const MINIMAP_HEIGHT = 84;
const MINIMAP_GAP = 8;

const editorShellStyle: CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    background: '#f2f4f7',
};

const nodeCardStyle: CSSProperties = {
    minWidth: 180,
    border: '1px solid #dde4ef',
    borderRadius: 14,
    padding: '8px 10px',
    background: '#ffffff',
    color: '#0f172a',
    boxShadow: '0 10px 20px rgba(15, 23, 42, 0.08)',
    position: 'relative',
};

const deleteNodeButtonStyle: CSSProperties = {
    position: 'absolute',
    top: 6,
    right: 6,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 20,
    height: 20,
    border: '1px solid rgba(127, 29, 29, 0.45)',
    borderRadius: 999,
    background: '#fee2e2',
    color: '#7f1d1d',
    cursor: 'pointer',
    fontSize: 15,
    lineHeight: 1,
    padding: 0,
};

const quickToolButtonStyle: CSSProperties = {
    width: 30,
    height: 30,
    border: '1px solid #d6deeb',
    borderRadius: 8,
    background: '#ffffff',
    color: '#475569',
    cursor: 'pointer',
    padding: 0,
};

const clampZoom = (value: number): number => Math.max(0.2, Math.min(2, value));
const safeViewportAxis = (value: number): number => (Number.isFinite(value) ? value : 0);

const getPortTop = (index: number, total: number): string => `${((index + 1) * 100) / (total + 1)}%`;

const createFallbackNodeTypes = (description: string): NodeSpec[] => [
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
        description,
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
        description,
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
            stroke: '#dc2626',
            strokeWidth: 2.4,
        }
        : undefined,
});

const PortTag = ({prefix, port}: { prefix: 'in' | 'out'; port: PortSpec }) => {
    const simpleType = simplifyFrameSchema(port.frame_schema);
    const color = getSchemaColor(port.frame_schema);
    return (
        <div
            style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: 10,
                color: '#334155',
                marginTop: 2,
            }}
        >
            <span style={{opacity: 0.9}}>{prefix}:{port.name}</span>
            <span
                style={{
                    fontSize: 10,
                    borderRadius: 999,
                    padding: '1px 6px',
                    background: `${color}1A`,
                    color,
                    border: `1px solid ${color}66`,
                }}
            >
                {simpleType}
            </span>
        </div>
    );
};

const WorkflowNode = ({data}: NodeProps<WorkflowNodeData>) => {
    const {t} = useTranslation();
    const inputs = data.spec.inputs ?? EMPTY_PORTS;
    const outputs = data.spec.outputs ?? EMPTY_PORTS;

    return (
        <div style={nodeCardStyle}>
            <button
                type="button"
                style={deleteNodeButtonStyle}
                aria-label={t('graphEditor.deleteNode', {nodeId: data.nodeId})}
                title={t('graphEditor.deleteNode', {nodeId: data.nodeId})}
                onClick={(event) => {
                    event.stopPropagation();
                    data.onDeleteNode(data.nodeId);
                }}
            >
                ×
            </button>
            <div style={{paddingRight: 20}}>
                <strong>{data.title}</strong>
                <div style={{fontSize: 11, color: '#475569'}}>{data.spec.type_name}</div>
            </div>
            <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 10, marginTop: 8}}>
                <div>
                    {inputs.map((port, index) => (
                        <div key={`in-${port.name}`}>
                            <Handle
                                id={`${TARGET_HANDLE_PREFIX}${port.name}`}
                                type="target"
                                position={Position.Left}
                                style={{
                                    top: getPortTop(index, inputs.length),
                                    width: 9,
                                    height: 9,
                                    border: `2px solid ${getSchemaColor(port.frame_schema)}`,
                                    background: '#fff',
                                }}
                            />
                            <PortTag prefix="in" port={port}/>
                        </div>
                    ))}
                </div>
                <div>
                    {outputs.map((port, index) => (
                        <div key={`out-${port.name}`}>
                            <Handle
                                id={`${SOURCE_HANDLE_PREFIX}${port.name}`}
                                type="source"
                                position={Position.Right}
                                style={{
                                    top: getPortTop(index, outputs.length),
                                    width: 9,
                                    height: 9,
                                    border: `2px solid ${getSchemaColor(port.frame_schema)}`,
                                    background: '#fff',
                                }}
                            />
                            <PortTag prefix="out" port={port}/>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

const nodeTypes = {workflowNode: WorkflowNode};

const GraphEditorInner = () => {
    const {t} = useTranslation();
    const graph = useGraphStore((state) => state.graph);
    const selectedNodeId = useGraphStore((state) => state.selectedNodeId);
    const setEdgesInStore = useGraphStore((state) => state.setEdges);
    const upsertNode = useGraphStore((state) => state.upsertNode);
    const removeNode = useGraphStore((state) => state.removeNode);
    const selectNode = useGraphStore((state) => state.selectNode);
    const validationIssues = useGraphStore((state) => state.validationIssues);

    const editorMode = useUiStore((state) => state.editorMode);
    const nodeLibraryOpen = useUiStore((state) => state.nodeLibraryOpen);
    const fitCanvasRequestTick = useUiStore((state) => state.fitCanvasRequestTick);
    const autoLayoutRequestTick = useUiStore((state) => state.autoLayoutRequestTick);
    const zoomMenuOpen = useUiStore((state) => state.zoomMenuOpen);
    const setNodeLibraryOpen = useUiStore((state) => state.setNodeLibraryOpen);
    const setEditorMode = useUiStore((state) => state.setEditorMode);
    const setZoomMenuOpen = useUiStore((state) => state.setZoomMenuOpen);

    const reactFlow = useReactFlow();
    const fallbackNodeTypes = useMemo(
        () => createFallbackNodeTypes(t('graphEditor.fallbackNodeTypeDescription')),
        [t],
    );
    const [catalog, setCatalog] = useState<NodeSpec[]>(fallbackNodeTypes);
    const [catalogLoading, setCatalogLoading] = useState(false);
    const [catalogError, setCatalogError] = useState<string | null>(null);
    const [editorMessage, setEditorMessage] = useState<string | null>(null);
    const [positions, setPositions] = useState<Record<string, XYPosition>>({});
    const [zoomRatio, setZoomRatio] = useState(0.7);

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

    const isInspectorOpen = selectedNodeId !== null;
    const bottomRightOffset = isInspectorOpen ? 352 : 0;
    const isHandMode = editorMode === 'hand';

    const syncEdgesToStore = useCallback(
        (edges: Edge[]) => {
            const specs = edges
                .map((edge) => edgeToSpec(edge))
                .filter((item): item is EdgeSpec => item !== null);
            setEdgesInStore(specs);
        },
        [setEdgesInStore],
    );

    const deleteNodeById = useCallback(
        (nodeId: string) => {
            removeNode(nodeId);
            setPositions((current) => {
                const next = {...current};
                delete next[nodeId];
                return next;
            });
            setEditorMessage(null);
        },
        [removeNode],
    );

    const resolveOutputPort = useCallback((nodeId: string, portName: string): PortSpec | null => {
        const node = graph.nodes.find((item) => item.node_id === nodeId);
        if (!node) {
            return null;
        }
        const spec = catalogByType.get(node.type_name);
        if (!spec) {
            return null;
        }
        return spec.outputs.find((port) => port.name === portName) ?? null;
    }, [catalogByType, graph.nodes]);

    const resolveInputPort = useCallback((nodeId: string, portName: string): PortSpec | null => {
        const node = graph.nodes.find((item) => item.node_id === nodeId);
        if (!node) {
            return null;
        }
        const spec = catalogByType.get(node.type_name);
        if (!spec) {
            return null;
        }
        return spec.inputs.find((port) => port.name === portName) ?? null;
    }, [catalogByType, graph.nodes]);

    const addNodeAt = useCallback(
        (typeName: string, position?: XYPosition) => {
            const spec = catalogByType.get(typeName);
            if (!spec) {
                setEditorMessage(t('graphEditor.errors.unknownNodeType', {typeName}));
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
                [nodeId]: position ?? reactFlow.screenToFlowPosition({x: 320, y: 200}),
            }));
            setEditorMessage(null);
        },
        [catalogByType, graph.nodes, reactFlow, t, upsertNode],
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
                    setCatalogError(t('graphEditor.errors.catalogUnavailable', {message: String(error)}));
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
    }, [t]);

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
                            border: '2px solid #dc2626',
                            boxShadow: '0 0 0 2px rgba(220, 38, 38, 0.12)',
                        }
                        : undefined,
                    data: {
                        nodeId: node.node_id,
                        title: node.title || node.type_name,
                        spec,
                        onDeleteNode: deleteNodeById,
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
    }, [catalogByType, deleteNodeById, fallbackNodeTypes, graph.edges, graph.nodes, positions, setRfEdges, setRfNodes, validationTargets]);

    useEffect(() => {
        if (fitCanvasRequestTick <= 0) {
            return;
        }
        window.requestAnimationFrame(() => {
            reactFlow.fitView({
                duration: 180,
                padding: 0.18,
            });
        });
    }, [fitCanvasRequestTick, reactFlow]);

    useEffect(() => {
        if (autoLayoutRequestTick <= 0) {
            return;
        }
        setPositions((current) => ({
            ...current,
            ...buildSimpleAutoLayout(graph),
        }));
        setEditorMessage(t('graphEditor.status.autoLayoutDone'));
    }, [autoLayoutRequestTick, graph, t]);

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

    const onConnect = useCallback(
        (connection: Connection) => {
            if (!connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) {
                setEditorMessage(t('graphEditor.errors.invalidConnection'));
                return;
            }
            if (!canBindTargetPort(rfEdges, connection.target, connection.targetHandle)) {
                setEditorMessage(t('graphEditor.errors.targetPortDuplicate'));
                return;
            }

            const sourcePort = connection.sourceHandle.slice(SOURCE_HANDLE_PREFIX.length);
            const targetPort = connection.targetHandle.slice(TARGET_HANDLE_PREFIX.length);
            const outputPort = resolveOutputPort(connection.source, sourcePort);
            const inputPort = resolveInputPort(connection.target, targetPort);
            if (!outputPort || !inputPort) {
                setEditorMessage(t('graphEditor.errors.invalidConnection'));
                return;
            }
            if (!isSchemaCompatible(outputPort.frame_schema, inputPort.frame_schema)) {
                setEditorMessage(
                    t('graphEditor.errors.schemaMismatch', {
                        sourceType: simplifyFrameSchema(outputPort.frame_schema),
                        targetType: simplifyFrameSchema(inputPort.frame_schema),
                    }),
                );
                return;
            }

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
        [resolveInputPort, resolveOutputPort, rfEdges, setRfEdges, syncEdgesToStore, t],
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

    const applyZoomDelta = (delta: number): void => {
        const nextZoom = clampZoom(Number((zoomRatio + delta).toFixed(2)));
        const viewport = reactFlow.getViewport();
        reactFlow.setViewport(
            {
                x: safeViewportAxis(viewport.x),
                y: safeViewportAxis(viewport.y),
                zoom: nextZoom,
            },
            {duration: 120},
        );
        setZoomRatio(nextZoom);
    };

    return (
        <section style={editorShellStyle} data-testid="graph-editor-shell">
            <aside
                aria-label="quick-tools"
                style={{
                    position: 'absolute',
                    left: 12,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    zIndex: 6,
                    border: '1px solid #dbe3ef',
                    borderRadius: 14,
                    padding: 6,
                    boxShadow: '0 14px 24px rgba(15, 23, 42, 0.08)',
                    background: 'rgba(255, 255, 255, 0.95)',
                    display: 'grid',
                    gap: 6,
                }}
            >
                <button
                    type="button"
                    title={t('graphEditor.quick.add')}
                    style={quickToolButtonStyle}
                    onClick={() => setNodeLibraryOpen(true)}
                >
                    +
                </button>
                <button
                    type="button"
                    title={t('graphEditor.quick.pointer')}
                    onClick={() => setEditorMode('pointer')}
                    style={{
                        ...quickToolButtonStyle,
                        borderColor: editorMode === 'pointer' ? '#93c5fd' : '#d6deeb',
                        background: editorMode === 'pointer' ? '#eff6ff' : '#ffffff',
                        color: editorMode === 'pointer' ? '#1d4ed8' : '#475569',
                    }}
                >
                    ↖
                </button>
                <button
                    type="button"
                    title={t('graphEditor.quick.hand')}
                    onClick={() => setEditorMode('hand')}
                    style={{
                        ...quickToolButtonStyle,
                        borderColor: editorMode === 'hand' ? '#93c5fd' : '#d6deeb',
                        background: editorMode === 'hand' ? '#eff6ff' : '#ffffff',
                        color: editorMode === 'hand' ? '#1d4ed8' : '#475569',
                    }}
                >
                    ✋
                </button>
                <button
                    type="button"
                    title={t('graphEditor.quick.arrange')}
                    style={quickToolButtonStyle}
                    onClick={() => useUiStore.getState().requestAutoLayout()}
                >
                    ⤓
                </button>
                <button
                    type="button"
                    title={t('graphEditor.quick.fit')}
                    style={quickToolButtonStyle}
                    onClick={() => useUiStore.getState().requestFitCanvas()}
                >
                    ⤢
                </button>
            </aside>

            {nodeLibraryOpen && (
                <aside
                    aria-label="node-library-drawer"
                    style={{
                        position: 'absolute',
                        left: 56,
                        top: 12,
                        bottom: 12,
                        width: 260,
                        zIndex: 8,
                        border: '1px solid #dce3ee',
                        borderRadius: 14,
                        background: 'rgba(255, 255, 255, 0.98)',
                        boxShadow: '0 18px 30px rgba(15, 23, 42, 0.1)',
                        padding: 10,
                        overflow: 'auto',
                    }}
                >
                    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                        <strong>{t('graphEditor.drawer.title')}</strong>
                        <button type="button" onClick={() => setNodeLibraryOpen(false)}>
                            ×
                        </button>
                    </div>
                    <div style={{fontSize: 12, opacity: 0.75, marginTop: 6}}>
                        {t('graphEditor.drawer.tip')}
                    </div>
                    <div style={{marginTop: 10, display: 'grid', gap: 8}}>
                        {catalog.map((nodeType) => (
                            <article
                                key={nodeType.type_name}
                                draggable
                                onDragStart={(event) => {
                                    event.dataTransfer.setData('application/x-starry-node-type', nodeType.type_name);
                                }}
                                style={{
                                    border: '1px solid #dce3ee',
                                    borderRadius: 12,
                                    padding: 8,
                                    background: '#fff',
                                }}
                            >
                                <div style={{fontWeight: 700, fontSize: 13}}>{nodeType.type_name}</div>
                                <div style={{fontSize: 11, color: '#64748b', marginTop: 2}}>
                                    {(nodeType.outputs ?? EMPTY_PORTS)
                                        .map((port) => simplifyFrameSchema(port.frame_schema))
                                        .join(' / ') || t('common.none')}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        addNodeAt(nodeType.type_name);
                                        setNodeLibraryOpen(false);
                                    }}
                                    style={{
                                        marginTop: 6,
                                        ...quickToolButtonStyle,
                                        width: '100%',
                                        height: 30,
                                    }}
                                >
                                    {t('graphEditor.drawer.add')}
                                </button>
                            </article>
                        ))}
                    </div>
                </aside>
            )}

            <div style={{position: 'absolute', inset: 0}} onDrop={onDropCanvas} onDragOver={onDragOverCanvas}>
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
                    onPaneClick={() => selectNode(null)}
                    onMoveEnd={(_event, viewport) => {
                        setZoomRatio(viewport.zoom);
                    }}
                    fitView
                    fitViewOptions={{padding: 0.2}}
                    panOnDrag={isHandMode}
                    panOnScroll={isHandMode}
                    nodesDraggable={isHandMode}
                    selectionOnDrag={!isHandMode}
                >
                    <Background
                        variant={BackgroundVariant.Dots}
                        color="#c3ccd8"
                        gap={22}
                        size={1.8}
                    />
                    <MiniMap
                        pannable
                        zoomable
                        style={{
                            width: MINIMAP_WIDTH,
                            height: MINIMAP_HEIGHT,
                            right: 12 + bottomRightOffset,
                            bottom: 12 + ZOOM_BAR_HEIGHT + MINIMAP_GAP,
                            margin: 0,
                            borderRadius: 12,
                            border: '1px solid #dce3ee',
                            boxShadow: '0 14px 24px rgba(15, 23, 42, 0.08)',
                            background: 'rgba(255, 255, 255, 0.96)',
                        }}
                    />
                </ReactFlow>
            </div>

            <div
                style={{
                    position: 'absolute',
                    left: 12,
                    bottom: 64,
                    zIndex: 6,
                    padding: '6px 10px',
                    borderRadius: 12,
                    border: '1px solid #dce3ee',
                    boxShadow: '0 12px 22px rgba(15, 23, 42, 0.08)',
                    background: 'rgba(255, 255, 255, 0.92)',
                    color: '#334155',
                    fontSize: 12,
                    maxWidth: 520,
                }}
            >
                {catalogLoading && <span data-testid="graph-editor-status">{t('graphEditor.status.loadingCatalog')}</span>}
                {!catalogLoading && catalogError && (
                    <span data-testid="graph-editor-status">
                        {t('graphEditor.status.fallbackCatalog', {error: catalogError})}
                    </span>
                )}
                {!catalogLoading && !catalogError && (
                    <span data-testid="graph-editor-status">{t('graphEditor.status.catalogReady', {count: catalog.length})}</span>
                )}
                {editorMessage && <span style={{marginLeft: 10, color: '#b91c1c'}}>{editorMessage}</span>}
            </div>

            <div
                style={{
                    position: 'absolute',
                    right: 12 + bottomRightOffset,
                    bottom: 12,
                    zIndex: 7,
                    width: ZOOM_BAR_WIDTH,
                }}
            >
                <div
                    data-testid="zoom-control-bar"
                    style={{
                        height: ZOOM_BAR_HEIGHT,
                        border: '1px solid #dbe3ef',
                        borderRadius: 12,
                        boxShadow: '0 12px 24px rgba(15, 23, 42, 0.08)',
                        background: 'rgba(255, 255, 255, 0.98)',
                        display: 'grid',
                        gridTemplateColumns: `${ZOOM_BAR_ICON_WIDTH}px ${ZOOM_BAR_RATIO_WIDTH}px ${ZOOM_BAR_ICON_WIDTH}px`,
                        overflow: 'hidden',
                    }}
                >
                    <button
                        type="button"
                        title={t('graphEditor.zoom.decrease')}
                        onClick={() => applyZoomDelta(-0.1)}
                        style={{
                            border: 'none',
                            borderRight: '1px solid #dbe3ef',
                            background: 'transparent',
                            cursor: 'pointer',
                            fontSize: 14,
                            color: '#475569',
                            padding: 0,
                        }}
                    >
                        −
                    </button>
                    <button
                        type="button"
                        data-testid="zoom-ratio-button"
                        onClick={() => setZoomMenuOpen(!zoomMenuOpen)}
                        style={{
                            border: 'none',
                            background: 'transparent',
                            cursor: 'pointer',
                            fontWeight: 600,
                            color: '#334155',
                            padding: 0,
                        }}
                    >
                        {Math.round(zoomRatio * 100)}%
                    </button>
                    <button
                        type="button"
                        title={t('graphEditor.zoom.increase')}
                        onClick={() => applyZoomDelta(0.1)}
                        style={{
                            border: 'none',
                            borderLeft: '1px solid #dbe3ef',
                            background: 'transparent',
                            cursor: 'pointer',
                            fontSize: 14,
                            color: '#475569',
                            padding: 0,
                        }}
                    >
                        +
                    </button>
                </div>
                {zoomMenuOpen && (
                    <div
                        style={{
                            border: '1px solid #dce3ee',
                            borderRadius: 12,
                            background: '#fff',
                            boxShadow: '0 14px 24px rgba(15, 23, 42, 0.1)',
                            padding: 6,
                            display: 'grid',
                            gap: 4,
                            position: 'absolute',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            bottom: ZOOM_BAR_HEIGHT + 8,
                        }}
                    >
                        {ZOOM_PRESETS.map((preset) => (
                            <button
                                key={preset}
                                type="button"
                                onClick={() => {
                                    const viewport = reactFlow.getViewport();
                                    reactFlow.setViewport({
                                        x: safeViewportAxis(viewport.x),
                                        y: safeViewportAxis(viewport.y),
                                        zoom: preset,
                                    }, {duration: 120});
                                    setZoomRatio(preset);
                                    setZoomMenuOpen(false);
                                }}
                            >
                                {Math.round(preset * 100)}%
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </section>
    );
};

export const GraphEditor = () => (
    <ReactFlowProvider>
        <GraphEditorInner/>
    </ReactFlowProvider>
);
