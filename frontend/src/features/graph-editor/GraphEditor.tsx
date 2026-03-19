import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type DragEvent,
    type MouseEvent as ReactMouseEvent,
    type TouchEvent as ReactTouchEvent,
} from 'react';
import {Expand, Hand, LayoutGrid, Minus, MousePointer2, Plus, Settings, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import ReactFlow, {
    Background,
    BackgroundVariant,
    Handle,
    MarkerType,
    MiniMap,
    Position,
    ReactFlowProvider,
    SelectionMode,
    applyEdgeChanges,
    applyNodeChanges,
    getNodesBounds,
    getViewportForBounds,
    type Connection,
    type Edge,
    type Node,
    type NodeChange,
    type NodeProps,
    type OnConnectStartParams,
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
import {changeAppLanguage, normalizeLanguage} from '../../shared/i18n/i18n';
import {translateNodeTypeDescription, translatePortDescription} from '../../shared/i18n/label-mappers';
import {
    getNodeBoundVariable,
    getValueKindLabel,
    isGenericDataNodeType,
    isVisibleDataLibraryType,
} from '../../shared/data-registry';
import {useGraphStore} from '../../shared/state/graph-store';
import {notifyUser} from '../../shared/state/global-info-store';
import {useUiStore} from '../../shared/state/ui-store';
import {SettingsDialog} from '../settings/SettingsDialog';
import {buildInitiatorDefaultConfig, isSyncInitiatorNodeType} from '../sync-config/managed-config';
import {
    SOURCE_HANDLE_PREFIX,
    TARGET_HANDLE_PREFIX,
    applyGraphClipboardSnapshot,
    buildEdgeId,
    buildElkAutoLayout,
    buildGraphClipboardSnapshot,
    canBindTargetPort,
    deriveValidationTargets,
    edgeToSpec,
    extractPortFromHandle,
    getSchemaColor,
    isSchemaCompatible,
    readNodePositionsFromMetadata,
    resolveGraphPortSchemas,
    simplifyFrameSchema,
    writeNodePositionsToMetadata,
} from './utils';

interface WorkflowNodeData {
    nodeId: string;
    title: string;
    config: Record<string, unknown>;
    spec: NodeSpec;
    boundVariableLabel: string | null;
    boundVariableKindLabel: string | null;
    isEditing: boolean;
    isValidationError: boolean;
    resolvedInputSchemas: Record<string, string>;
    resolvedOutputSchemas: Record<string, string>;
    onSelectNode: (nodeId: string) => void;
}

const EMPTY_PORTS: NodeSpec['inputs'] = [];
const ZOOM_PRESETS = [0.5, 0.7, 1, 1.2, 1.5];
const ZOOM_HUD_HEIGHT = 44;
const ZOOM_BAR_HEIGHT = ZOOM_HUD_HEIGHT;
const ZOOM_BAR_ICON_WIDTH = 32;
const ZOOM_BAR_RATIO_WIDTH = 68;
const ZOOM_BAR_WIDTH = ZOOM_BAR_ICON_WIDTH * 2 + ZOOM_BAR_RATIO_WIDTH;
const MINIMAP_WIDTH = ZOOM_BAR_WIDTH;
const MINIMAP_HEIGHT = 84;
const MINIMAP_GAP = 8;
const NODE_LIBRARY_TOP_INSET = 60;
const NODE_LIBRARY_BOTTOM_INSET = 88;
const NON_LINEAR_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const BOTTOM_RIGHT_SHIFT_TRANSITION = `right 180ms ${NON_LINEAR_EASE}`;
const DEFAULT_EDGE_COLOR = '#64748b';
const DEFAULT_ZOOM_RATIO = 0.7;
const PASTE_OFFSET: XYPosition = {x: 48, y: 48};
const INSPECTOR_OVERLAY_WIDTH = 352;
const FIT_CANVAS_PADDING = 0.18;

interface NodeContextMenuState {
    nodeId: string;
    x: number;
    y: number;
}

type ContextMenuActionKey = 'copy' | 'duplicate' | 'delete';
type ZoomControlActionKey = 'decrease' | 'ratio' | 'increase';

const editorShellStyle: CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    background: '#f2f4f7',
};

const NODE_CARD_RADIUS = 14;
const NODE_CARD_BORDER_WIDTH = 0;
const NODE_CARD_HORIZONTAL_PADDING = 6;
const PORT_HANDLE_SIZE = 9;
const PORT_ROW_INSET = 6;
const NODE_TITLE_INSET = PORT_ROW_INSET;
const NODE_CARD_WIDTH = 220;
const NODE_CARD_MIN_HEIGHT = 56;

const nodeCardStyle: CSSProperties = {
    width: NODE_CARD_WIDTH,
    minHeight: NODE_CARD_MIN_HEIGHT,
    border: '1px solid #dde4ef',
    borderRadius: NODE_CARD_RADIUS,
    padding: `8px ${NODE_CARD_HORIZONTAL_PADDING}px 9px`,
    background: '#ffffff',
    color: '#0f172a',
    boxShadow: '0 10px 20px rgba(15, 23, 42, 0.08)',
    position: 'relative',
};

const buildNodeCardStyle = (isEditing: boolean, isValidationError: boolean): CSSProperties => {
    if (!isEditing && !isValidationError) {
        return nodeCardStyle;
    }
    const rings: string[] = [];
    if (isValidationError) {
        const errorStrokeWidth = isEditing ? 4 : 2;
        const errorGlowWidth = 10;
        rings.push(
            `0 0 0 ${errorStrokeWidth}px #dc2626`,
            `0 0 0 ${errorGlowWidth}px rgba(220, 38, 38, 0.24)`,
        );
    }
    if (isEditing && !isValidationError) {
        rings.push('0 0 0 3px rgba(59, 130, 246, 0.26)');
    }
    rings.push('0 10px 20px rgba(15, 23, 42, 0.08)');
    return {
        ...nodeCardStyle,
        boxShadow: rings.join(', '),
    };
};

const passiveNodeCardStyle: CSSProperties = {
    ...nodeCardStyle,
    background: 'linear-gradient(180deg, #fff7ed 0%, #fffbeb 100%)',
    border: '1px dashed #f59e0b',
    boxShadow: '0 8px 18px rgba(245, 158, 11, 0.12)',
};

const buildPassiveNodeCardStyle = (isEditing: boolean, isValidationError: boolean): CSSProperties => {
    const base = buildNodeCardStyle(isEditing, isValidationError);
    return {
        ...base,
        background: passiveNodeCardStyle.background,
        border: passiveNodeCardStyle.border,
        boxShadow: passiveNodeCardStyle.boxShadow,
    };
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
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
};

const quickToolDividerStyle: CSSProperties = {
    height: 1,
    margin: '2px 3px',
    borderRadius: 999,
    background: '#dbe3ef',
};

const nodeLibraryCloseButtonStyle: CSSProperties = {
    width: 24,
    height: 24,
    border: '1px solid #d5dff0',
    borderRadius: 8,
    background: '#fff',
    color: '#475569',
    cursor: 'pointer',
    padding: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    lineHeight: 1,
};

const clampZoom = (value: number): number => Math.max(0.2, Math.min(2, value));
const safeZoomRatio = (value: number, fallback = DEFAULT_ZOOM_RATIO): number =>
    Number.isFinite(value) ? clampZoom(value) : fallback;
const safeViewportAxis = (value: number): number => (Number.isFinite(value) ? value : 0);
const isEditableElement = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) {
        return false;
    }
    const tag = target.tagName.toLowerCase();
    return target.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select';
};

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

const toRfEdge = (edge: EdgeSpec, strokeColor: string, highlighted = false): Edge => ({
    id: buildEdgeId(edge.source_node, edge.source_port, edge.target_node, edge.target_port),
    source: edge.source_node,
    sourceHandle: `${SOURCE_HANDLE_PREFIX}${edge.source_port}`,
    target: edge.target_node,
    targetHandle: `${TARGET_HANDLE_PREFIX}${edge.target_port}`,
    markerEnd: {
        type: MarkerType.ArrowClosed,
        color: strokeColor,
    },
    style: {
        stroke: strokeColor,
        strokeWidth: highlighted ? 2.8 : 2,
    },
});

const PortTag = ({prefix, port}: { prefix: 'in' | 'out'; port: PortSpec }) => {
    const simpleType = simplifyFrameSchema(port.frame_schema);
    const color = getSchemaColor(port.frame_schema);
    const isInput = prefix === 'in';
    const handlePosition = isInput ? Position.Left : Position.Right;
    const handleId = `${isInput ? TARGET_HANDLE_PREFIX : SOURCE_HANDLE_PREFIX}${port.name}`;
    const edgeAnchor = -(NODE_CARD_HORIZONTAL_PADDING + NODE_CARD_BORDER_WIDTH);
    const label = (
        <span
            style={{
                opacity: 0.9,
                flex: '0 1 auto',
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
            }}
        >
            {port.name}
        </span>
    );
    const schemaPill = (
        <span
            style={{
                fontSize: 10,
                borderRadius: 999,
                padding: '1px 6px',
                background: `${color}1A`,
                color,
                border: `1px solid ${color}66`,
                flexShrink: 0,
            }}
        >
            {simpleType}
        </span>
    );
    return (
        <div
            style={{
                position: 'relative',
                display: 'flex',
                justifyContent: isInput ? 'flex-start' : 'flex-end',
                paddingLeft: isInput ? PORT_ROW_INSET : 0,
                paddingRight: isInput ? 0 : PORT_ROW_INSET,
                marginTop: 1,
            }}
            data-testid={`port-tag-${prefix}-${port.name}`}
        >
            <Handle
                id={handleId}
                type={isInput ? 'target' : 'source'}
                position={handlePosition}
                style={{
                    top: '50%',
                    left: isInput ? edgeAnchor : undefined,
                    right: isInput ? undefined : edgeAnchor,
                    transform: isInput ? 'translate(-50%, -50%)' : 'translate(50%, -50%)',
                    boxSizing: 'border-box',
                    width: PORT_HANDLE_SIZE,
                    height: PORT_HANDLE_SIZE,
                    border: `2px solid ${color}`,
                    background: '#fff',
                }}
            />
            <div
                style={{
                    display: 'inline-flex',
                    justifyContent: 'flex-start',
                    alignItems: 'center',
                    fontSize: 10,
                    color: '#334155',
                    columnGap: 3,
                    minWidth: 0,
                    maxWidth: '100%',
                    textAlign: 'left',
                }}
            >
                {isInput ? schemaPill : label}
                {isInput ? label : schemaPill}
            </div>
        </div>
    );
};

const DrawerPortTag = ({nodeTypeName, prefix, port}: { nodeTypeName: string; prefix: 'in' | 'out'; port: PortSpec }) => {
    const {t} = useTranslation();
    const simpleType = simplifyFrameSchema(port.frame_schema);
    const color = getSchemaColor(port.frame_schema);
    const localizedDescription = translatePortDescription(t, nodeTypeName, port.name, port.description);

    return (
        <div
            title={localizedDescription}
            style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                minWidth: 0,
            }}
            data-testid={`drawer-port-tag-${prefix}-${port.name}`}
        >
            <span
                aria-hidden="true"
                style={{
                    width: 10,
                    height: 10,
                    marginTop: 4,
                    borderRadius: '50%',
                    border: `2px solid ${color}`,
                    background: '#fff',
                    boxSizing: 'border-box',
                    flexShrink: 0,
                }}
            />
            <div
                style={{
                    display: 'grid',
                    gap: 4,
                    minWidth: 0,
                    flex: 1,
                }}
            >
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        flexWrap: 'wrap',
                        minWidth: 0,
                    }}
                >
                    <strong
                        style={{
                            fontSize: 12,
                            lineHeight: 1.35,
                            color: '#0f172a',
                            wordBreak: 'break-word',
                        }}
                    >
                        {port.name}
                    </strong>
                    <span
                        style={{
                            fontSize: 10,
                            borderRadius: 999,
                            padding: '1px 6px',
                            background: `${color}1A`,
                            color,
                            border: `1px solid ${color}66`,
                            flexShrink: 0,
                        }}
                    >
                        {simpleType}
                    </span>
                </div>
                {localizedDescription ? (
                    <div
                        style={{
                            fontSize: 11,
                            lineHeight: 1.45,
                            color: '#64748b',
                            wordBreak: 'break-word',
                        }}
                    >
                        {localizedDescription}
                    </div>
                ) : null}
            </div>
        </div>
    );
};

const DrawerPortSection = ({
    nodeTypeName,
    prefix,
    ports,
}: {
    nodeTypeName: string;
    prefix: 'in' | 'out';
    ports: PortSpec[];
}) => {
    const {t} = useTranslation();

    return (
        <section style={{display: 'grid', gap: 6, minWidth: 0}}>
            <div
                style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    color: '#94a3b8',
                    textTransform: 'uppercase',
                }}
            >
                {t(prefix === 'in' ? 'graphEditor.drawer.inputs' : 'graphEditor.drawer.outputs')}
            </div>
            {ports.length === 0 ? (
                <div style={{fontSize: 11, lineHeight: 1.4, color: '#94a3b8'}}>{t('common.none')}</div>
            ) : (
                <div style={{display: 'grid', gap: 8, minWidth: 0}}>
                    {ports.map((port) => (
                        <DrawerPortTag
                            key={`drawer-${prefix}-${nodeTypeName}-${port.name}`}
                            nodeTypeName={nodeTypeName}
                            prefix={prefix}
                            port={port}
                        />
                    ))}
                </div>
            )}
        </section>
    );
};

const nodeTitleStyle: CSSProperties = {
    display: 'block',
    fontSize: 13,
    lineHeight: 1.35,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
};

const nodeSubtitleStyle: CSSProperties = {
    display: 'block',
    marginTop: 0,
    fontSize: 11,
    lineHeight: 1.25,
    color: '#94a3b8',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
};

const nodeHeaderStyle: CSSProperties = {
    paddingLeft: NODE_TITLE_INSET,
    paddingRight: NODE_TITLE_INSET,
};

const isPassiveDataTypeNode = (spec: NodeSpec): boolean => spec.mode === 'passive' && isGenericDataNodeType(spec.type_name);

const resolveDataTypeNodeSubtitle = (
    t: ReturnType<typeof useTranslation>['t'],
    data: Pick<WorkflowNodeData, 'boundVariableKindLabel' | 'boundVariableLabel' | 'config' | 'spec' | 'resolvedOutputSchemas'>,
): string => {
    if (data.boundVariableLabel && data.boundVariableKindLabel) {
        return `${data.boundVariableLabel} · ${data.boundVariableKindLabel}`;
    }
    if (data.boundVariableKindLabel) {
        return data.boundVariableKindLabel;
    }
    if (isGenericDataNodeType(data.spec.type_name)) {
        return t('graphEditor.nodeTypeBadges.dataRefUnbound', {defaultValue: '未绑定'});
    }

    const valuePort = data.spec.outputs?.find((port) => port.name === 'value');
    const resolvedValueSchema = data.resolvedOutputSchemas.value ?? valuePort?.frame_schema ?? '';
    const simpleType = simplifyFrameSchema(resolvedValueSchema);
    return simpleType || t('graphEditor.nodeTypeBadges.dataType', {defaultValue: '数据类型'});
};

const resolveNodeNamespaceSubtitle = (
    t: ReturnType<typeof useTranslation>['t'],
    spec: Pick<NodeSpec, 'type_name' | 'mode'>,
): string => {
    const [namespace] = spec.type_name.split('.');
    if (namespace) {
        return namespace;
    }
    if (spec.mode === 'sync') {
        return t('graphEditor.nodeTypeBadges.syncNode', {defaultValue: '同步节点'});
    }
    if (spec.mode === 'passive') {
        return t('graphEditor.nodeTypeBadges.passiveNode', {defaultValue: '被动节点'});
    }
    return t('graphEditor.nodeTypeBadges.asyncNode', {defaultValue: '异步节点'});
};

const resolveWorkflowNodeSubtitle = (
    t: ReturnType<typeof useTranslation>['t'],
    data: Pick<WorkflowNodeData, 'boundVariableKindLabel' | 'boundVariableLabel' | 'config' | 'spec' | 'resolvedOutputSchemas'>,
): string => {
    if (isPassiveDataTypeNode(data.spec)) {
        return resolveDataTypeNodeSubtitle(t, data);
    }
    return resolveNodeNamespaceSubtitle(t, data.spec);
};

const WorkflowNode = ({data}: NodeProps<WorkflowNodeData>) => {
    const {t} = useTranslation();
    const inputs = (data.spec.inputs ?? EMPTY_PORTS).map((port) => ({
        ...port,
        frame_schema: data.resolvedInputSchemas[port.name] ?? port.frame_schema,
    }));
    const outputs = (data.spec.outputs ?? EMPTY_PORTS).map((port) => ({
        ...port,
        frame_schema: data.resolvedOutputSchemas[port.name] ?? port.frame_schema,
    }));
    const subtitle = resolveWorkflowNodeSubtitle(t, data);

    return (
        <div
            style={
                data.spec.mode === 'passive'
                    ? buildPassiveNodeCardStyle(data.isEditing, data.isValidationError)
                    : buildNodeCardStyle(data.isEditing, data.isValidationError)
            }
            data-testid={`workflow-node-${data.nodeId}`}
            onClick={() => data.onSelectNode(data.nodeId)}
        >
            <div style={nodeHeaderStyle}>
                <strong style={nodeTitleStyle}>{data.title}</strong>
                <span style={nodeSubtitleStyle} data-testid="workflow-node-subtitle">{subtitle}</span>
            </div>
            <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 6, marginTop: 8}}>
                <div>
                    {inputs.map((port) => (
                        <PortTag key={`in-${port.name}`} prefix="in" port={port}/>
                    ))}
                </div>
                <div>
                    {outputs.map((port) => (
                        <PortTag key={`out-${port.name}`} prefix="out" port={port}/>
                    ))}
                </div>
            </div>
        </div>
    );
};

const nodeTypes = {workflowNode: WorkflowNode};

const GraphEditorInner = () => {
    const {t, i18n} = useTranslation();
    const graph = useGraphStore((state) => state.graph);
    const selectedNodeId = useGraphStore((state) => state.selectedNodeId);
    const setNodesInStore = useGraphStore((state) => state.setNodes);
    const setEdgesInStore = useGraphStore((state) => state.setEdges);
    const setMetadataInStore = useGraphStore((state) => state.setMetadata);
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
    const requestFitCanvas = useUiStore((state) => state.requestFitCanvas);

    const reactFlow = useReactFlow();
    const fallbackNodeTypes = useMemo(
        () => createFallbackNodeTypes(t('graphEditor.fallbackNodeTypeDescription')),
        [t],
    );
    const [catalog, setCatalog] = useState<NodeSpec[]>(fallbackNodeTypes);
    const [zoomRatio, setZoomRatio] = useState(DEFAULT_ZOOM_RATIO);
    const [activeConnectionColor, setActiveConnectionColor] = useState(DEFAULT_EDGE_COLOR);
    const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
    const [nodeContextMenu, setNodeContextMenu] = useState<NodeContextMenuState | null>(null);
    const [hoveredContextAction, setHoveredContextAction] = useState<ContextMenuActionKey | null>(null);
    const [hoveredZoomAction, setHoveredZoomAction] = useState<ZoomControlActionKey | null>(null);
    const [hoveredZoomPreset, setHoveredZoomPreset] = useState<number | null>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const canvasViewportRef = useRef<HTMLDivElement | null>(null);
    const zoomControlRef = useRef<HTMLDivElement | null>(null);
    const handledFitCanvasTickRef = useRef(0);
    const handledAutoLayoutTickRef = useRef(0);
    const pendingAutoLayoutFitRef = useRef(false);
    const autoLayoutFitFallbackTimerRef = useRef<number | null>(null);

    const clipboardRef = useRef<ReturnType<typeof buildGraphClipboardSnapshot>>(null);
    const pasteCountRef = useRef(0);

    const [rfNodes, setRfNodes] = useNodesState<WorkflowNodeData>([]);
    const [rfEdges, setRfEdges] = useEdgesState([]);
    const shortcutModifierLabel = useMemo(() => {
        if (typeof navigator === 'undefined') {
            return 'Ctrl';
        }
        const platform = navigator.platform.toLowerCase();
        return platform.includes('mac') ? '⌘' : 'Ctrl';
    }, []);

    const clearAutoLayoutFitFallbackTimer = useCallback(() => {
        if (autoLayoutFitFallbackTimerRef.current !== null) {
            window.clearTimeout(autoLayoutFitFallbackTimerRef.current);
            autoLayoutFitFallbackTimerRef.current = null;
        }
    }, []);

    const completePendingAutoLayoutFit = useCallback(() => {
        pendingAutoLayoutFitRef.current = false;
        clearAutoLayoutFitFallbackTimer();
        requestFitCanvas();
    }, [clearAutoLayoutFitFallbackTimer, requestFitCanvas]);

    const canCompletePendingAutoLayoutFit = useCallback((): boolean => {
        if (graph.nodes.length === 0 || rfNodes.length === 0) {
            return false;
        }
        const internalNodes = reactFlow.getNodes();
        if (internalNodes.length < graph.nodes.length) {
            return false;
        }
        return internalNodes.every(
            (node) =>
                typeof node.width === 'number' &&
                Number.isFinite(node.width) &&
                node.width > 0 &&
                typeof node.height === 'number' &&
                Number.isFinite(node.height) &&
                node.height > 0,
        );
    }, [graph.nodes.length, reactFlow, rfNodes]);

    const scheduleAutoLayoutFitFallback = useCallback(() => {
        clearAutoLayoutFitFallbackTimer();
        autoLayoutFitFallbackTimerRef.current = window.setTimeout(() => {
            if (!pendingAutoLayoutFitRef.current) {
                return;
            }
            completePendingAutoLayoutFit();
        }, 120);
    }, [clearAutoLayoutFitFallbackTimer, completePendingAutoLayoutFit]);

    useEffect(() => () => {
        clearAutoLayoutFitFallbackTimer();
    }, [clearAutoLayoutFitFallbackTimer]);

    const catalogByType = useMemo(() => {
        const index = new Map<string, NodeSpec>();
        for (const item of catalog) {
            index.set(item.type_name, item);
        }
        return index;
    }, [catalog]);
    const resolvedPortSchemas = useMemo(
        () => resolveGraphPortSchemas(graph, catalogByType),
        [catalogByType, graph],
    );

    const validationTargets = useMemo(
        () => deriveValidationTargets(graph, validationIssues),
        [graph, validationIssues],
    );
    const graphNodeIds = useMemo(() => graph.nodes.map((node) => node.node_id), [graph.nodes]);
    const graphNodeIdSet = useMemo(() => new Set(graphNodeIds), [graphNodeIds]);
    const positions = useMemo(
        () => readNodePositionsFromMetadata(graph.metadata, graphNodeIdSet),
        [graph.metadata, graphNodeIdSet],
    );

    const isInspectorOpen = selectedNodeId !== null;
    const bottomRightOffset = isInspectorOpen ? INSPECTOR_OVERLAY_WIDTH : 0;
    const isHandMode = editorMode === 'hand';
    const currentLanguage = normalizeLanguage(i18n.resolvedLanguage ?? i18n.language);

    const handleLanguageChange = useCallback((language: string) => {
        const nextLanguage = normalizeLanguage(language);
        void changeAppLanguage(nextLanguage);
    }, []);

    const fitCanvasToVisibleArea = useCallback(() => {
        const internalNodes = reactFlow.getNodes();
        const nodesForBounds = internalNodes.length > 0 ? internalNodes : rfNodes;
        if (nodesForBounds.length === 0) {
            return;
        }
        const viewportContainer = canvasViewportRef.current;
        if (!viewportContainer) {
            reactFlow.fitView({padding: FIT_CANVAS_PADDING});
            return;
        }
        const containerWidth = viewportContainer.clientWidth;
        const containerHeight = viewportContainer.clientHeight;
        if (containerWidth <= 0 || containerHeight <= 0) {
            reactFlow.fitView({padding: FIT_CANVAS_PADDING});
            return;
        }
        const visibleWidth = Math.max(
            containerWidth - (isInspectorOpen ? INSPECTOR_OVERLAY_WIDTH : 0),
            containerWidth * 0.35,
        );
        const bounds = getNodesBounds(nodesForBounds);
        const viewport = getViewportForBounds(bounds, visibleWidth, containerHeight, 0.2, 2, FIT_CANVAS_PADDING);
        const nextZoom = safeZoomRatio(viewport.zoom);
        reactFlow.setViewport({
            x: safeViewportAxis(viewport.x),
            y: safeViewportAxis(viewport.y),
            zoom: nextZoom,
        });
        setZoomRatio(nextZoom);
    }, [isInspectorOpen, reactFlow, rfNodes]);

    const syncEdgesToStore = useCallback(
        (edges: Edge[]) => {
            const specs = edges
                .map((edge) => edgeToSpec(edge))
                .filter((item): item is EdgeSpec => item !== null);
            setEdgesInStore(specs);
        },
        [setEdgesInStore],
    );

    const updateNodePositions = useCallback(
        (
            updater: (current: Record<string, XYPosition>) => Record<string, XYPosition>,
            nodeIds = graphNodeIds,
        ) => {
            const currentPositions = readNodePositionsFromMetadata(graph.metadata, graphNodeIdSet);
            for (const nodeId of nodeIds) {
                if (currentPositions[nodeId]) {
                    continue;
                }
                const flowNode = reactFlow.getNode(nodeId);
                if (!flowNode?.position) {
                    continue;
                }
                const {x, y} = flowNode.position;
                if (!Number.isFinite(x) || !Number.isFinite(y)) {
                    continue;
                }
                currentPositions[nodeId] = {x, y};
            }
            const nextPositions = updater(currentPositions);
            const nextMetadata = writeNodePositionsToMetadata(graph.metadata, nextPositions, nodeIds);
            setMetadataInStore(nextMetadata);
        },
        [graph.metadata, graphNodeIdSet, graphNodeIds, reactFlow, setMetadataInStore],
    );

    const closeNodeContextMenu = useCallback(() => {
        setNodeContextMenu(null);
        setHoveredContextAction(null);
    }, []);

    const getNodePosition = useCallback(
        (nodeId: string): XYPosition => {
            const flowNode = reactFlow.getNode(nodeId);
            if (flowNode?.position) {
                return flowNode.position;
            }
            return positions[nodeId] ?? {x: 0, y: 0};
        },
        [positions, reactFlow],
    );

    const collectNodeSizesForLayout = useCallback((): Record<string, {width: number; height: number}> => {
        const measuredSizes: Record<string, {width: number; height: number}> = {};
        for (const nodeId of graphNodeIds) {
            const flowNode = reactFlow.getNode(nodeId);
            const width = flowNode?.width;
            const height = flowNode?.height;
            if (
                typeof width !== 'number' ||
                !Number.isFinite(width) ||
                width <= 0 ||
                typeof height !== 'number' ||
                !Number.isFinite(height) ||
                height <= 0
            ) {
                continue;
            }
            measuredSizes[nodeId] = {width, height};
        }
        return measuredSizes;
    }, [graphNodeIds, reactFlow]);

    const resolveNodeIdsForAction = useCallback(
        (anchorNodeId: string): string[] => {
            const normalized = anchorNodeId.trim();
            if (!normalized) {
                return [];
            }
            if (selectedNodeIds.length > 1 && selectedNodeIds.includes(normalized)) {
                return selectedNodeIds;
            }
            return [normalized];
        },
        [selectedNodeIds],
    );

    const copyNodesToClipboard = useCallback(
        (nodeIds: string[]): boolean => {
            const normalizedNodeIds = [...new Set(nodeIds.map((nodeId) => nodeId.trim()).filter(Boolean))];
            if (normalizedNodeIds.length === 0) {
                return false;
            }
            const resolvedPositions: Record<string, XYPosition> = {};
            for (const nodeId of normalizedNodeIds) {
                resolvedPositions[nodeId] = getNodePosition(nodeId);
            }
            const snapshot = buildGraphClipboardSnapshot(graph, normalizedNodeIds, resolvedPositions);
            if (!snapshot) {
                return false;
            }
            clipboardRef.current = snapshot;
            pasteCountRef.current = 0;
            notifyUser.success(
                t('graphEditor.status.copiedNodes', {
                    count: snapshot.nodes.length,
                }),
            );
            return true;
        },
        [getNodePosition, graph, t],
    );

    const pasteClipboardNodes = useCallback((): boolean => {
        const snapshot = clipboardRef.current;
        if (!snapshot) {
            return false;
        }
        const resolvedPositions: Record<string, XYPosition> = {...positions};
        for (const node of graph.nodes) {
            if (!resolvedPositions[node.node_id]) {
                resolvedPositions[node.node_id] = getNodePosition(node.node_id);
            }
        }

        pasteCountRef.current += 1;
        const pasteResult = applyGraphClipboardSnapshot(graph, resolvedPositions, snapshot, {
            offset: PASTE_OFFSET,
            pasteCount: pasteCountRef.current,
        });
        if (!pasteResult) {
            return false;
        }
        setNodesInStore(pasteResult.nodes);
        setEdgesInStore(pasteResult.edges);
        updateNodePositions(
            () => pasteResult.positions,
            pasteResult.nodes.map((node) => node.node_id),
        );
        setSelectedNodeIds(pasteResult.createdNodeIds);
        selectNode(pasteResult.createdNodeIds[0] ?? null);
        notifyUser.success(
            t('graphEditor.status.pastedNodes', {
                count: pasteResult.createdNodeIds.length,
            }),
        );
        return true;
    }, [getNodePosition, graph, positions, selectNode, setEdgesInStore, setNodesInStore, t, updateNodePositions]);

    const deleteNodesByIds = useCallback(
        (nodeIds: string[]) => {
            const normalizedNodeIds = [...new Set(nodeIds.map((nodeId) => nodeId.trim()).filter(Boolean))];
            if (normalizedNodeIds.length === 0) {
                return;
            }
            for (const nodeId of normalizedNodeIds) {
                removeNode(nodeId);
            }
            const remainingNodeIds = graph.nodes
                .map((node) => node.node_id)
                .filter((nodeId) => !normalizedNodeIds.includes(nodeId));
            updateNodePositions((current) => {
                const next = {...current};
                for (const nodeId of normalizedNodeIds) {
                    delete next[nodeId];
                }
                return next;
            }, remainingNodeIds);
            setSelectedNodeIds((current) => current.filter((nodeId) => !normalizedNodeIds.includes(nodeId)));
        },
        [graph.nodes, removeNode, updateNodePositions],
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
        const outputPorts = Array.isArray(spec.outputs) ? spec.outputs : [];
        const port = outputPorts.find((item) => item.name === portName);
        if (!port) {
            return null;
        }
        const resolvedSchema = resolvedPortSchemas.outputs[nodeId]?.[port.name] ?? port.frame_schema;
        return {
            ...port,
            frame_schema: resolvedSchema,
        };
    }, [catalogByType, graph.nodes, resolvedPortSchemas.outputs]);

    const resolveInputPort = useCallback((nodeId: string, portName: string): PortSpec | null => {
        const node = graph.nodes.find((item) => item.node_id === nodeId);
        if (!node) {
            return null;
        }
        const spec = catalogByType.get(node.type_name);
        if (!spec) {
            return null;
        }
        const inputPorts = Array.isArray(spec.inputs) ? spec.inputs : [];
        const port = inputPorts.find((item) => item.name === portName);
        if (!port) {
            return null;
        }
        const resolvedSchema = resolvedPortSchemas.inputs[nodeId]?.[port.name] ?? port.frame_schema;
        return {
            ...port,
            frame_schema: resolvedSchema,
        };
    }, [catalogByType, graph.nodes, resolvedPortSchemas.inputs]);

    const resolveEdgeColor = useCallback((edge: EdgeSpec): string => {
        const sourcePort = resolveOutputPort(edge.source_node, edge.source_port);
        return sourcePort ? getSchemaColor(sourcePort.frame_schema) : DEFAULT_EDGE_COLOR;
    }, [resolveOutputPort]);

    const resolveConnectionColor = useCallback(
        (nodeId: string | null, handleId: string | null, handleType: 'source' | 'target' | null): string => {
            if (!nodeId || !handleId || !handleType) {
                return DEFAULT_EDGE_COLOR;
            }
            if (handleType === 'source') {
                const sourcePortName = extractPortFromHandle(handleId, SOURCE_HANDLE_PREFIX);
                if (!sourcePortName) {
                    return DEFAULT_EDGE_COLOR;
                }
                const sourcePort = resolveOutputPort(nodeId, sourcePortName);
                return sourcePort ? getSchemaColor(sourcePort.frame_schema) : DEFAULT_EDGE_COLOR;
            }
            const targetPortName = extractPortFromHandle(handleId, TARGET_HANDLE_PREFIX);
            if (!targetPortName) {
                return DEFAULT_EDGE_COLOR;
            }
            const targetPort = resolveInputPort(nodeId, targetPortName);
            return targetPort ? getSchemaColor(targetPort.frame_schema) : DEFAULT_EDGE_COLOR;
        },
        [resolveInputPort, resolveOutputPort],
    );

    const addNodeAt = useCallback(
        (typeName: string, position?: XYPosition) => {
            const spec = catalogByType.get(typeName);
            if (!spec) {
                notifyUser.error(t('graphEditor.errors.unknownNodeType', {typeName}));
                return;
            }
            const nodeId = nextNodeId(graph.nodes);
            const nodeConfig = (() => {
                if (isSyncInitiatorNodeType(spec.type_name)) {
                    return buildInitiatorDefaultConfig(graph.nodes);
                }
                switch (spec.type_name) {
                    case 'data.ref':
                        return {variable_name: ''};
                    case 'data.writer':
                        return {
                            target_variable_name: '',
                            operation: 'set_from_input',
                            operand_mode: 'literal',
                            literal_value: 0,
                        };
                    default:
                        return {};
                }
            })();
            upsertNode({
                node_id: nodeId,
                type_name: spec.type_name,
                title: spec.type_name,
                config: nodeConfig,
            });
            const nodePosition = position ?? reactFlow.screenToFlowPosition({x: 320, y: 200});
            updateNodePositions(
                (current) => ({
                    ...current,
                    [nodeId]: nodePosition,
                }),
                [...graphNodeIds, nodeId],
            );
        },
        [catalogByType, graph.nodes, graphNodeIds, reactFlow, t, updateNodePositions, upsertNode],
    );

    useEffect(() => {
        let cancelled = false;
        const loadCatalog = async () => {
            try {
                const payload = await apiClient.listNodeTypes();
                if (!cancelled && payload.items.length > 0) {
                    setCatalog(payload.items);
                }
            } catch (error) {
                if (!cancelled) {
                    notifyUser.warning(t('graphEditor.status.fallbackCatalog', {error: String(error)}));
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
                    data: {
                        nodeId: node.node_id,
                        title: node.title || node.type_name,
                        config: node.config ?? {},
                        spec,
                        boundVariableLabel: getNodeBoundVariable(graph.metadata, node)?.name ?? null,
                        boundVariableKindLabel: (() => {
                            const variable = getNodeBoundVariable(graph.metadata, node);
                            return variable ? getValueKindLabel(variable.value_kind) : null;
                        })(),
                        isEditing: node.node_id === selectedNodeId,
                        isValidationError: highlighted,
                        resolvedInputSchemas: resolvedPortSchemas.inputs[node.node_id] ?? {},
                        resolvedOutputSchemas: resolvedPortSchemas.outputs[node.node_id] ?? {},
                        onSelectNode: selectNode,
                    },
                };
            }),
        );
        setRfEdges(
            graph.edges.map((edge) =>
                toRfEdge(
                    edge,
                    resolveEdgeColor(edge),
                    validationTargets.edgeIds.has(
                        buildEdgeId(edge.source_node, edge.source_port, edge.target_node, edge.target_port),
                    ),
                ),
            ),
        );
    }, [
        catalogByType,
        fallbackNodeTypes,
        graph.edges,
        graph.nodes,
        positions,
        resolvedPortSchemas.inputs,
        resolvedPortSchemas.outputs,
        resolveEdgeColor,
        selectedNodeId,
        selectNode,
        setRfEdges,
        setRfNodes,
        validationTargets,
    ]);

    useEffect(() => {
        if (fitCanvasRequestTick <= 0 || fitCanvasRequestTick === handledFitCanvasTickRef.current) {
            return;
        }
        handledFitCanvasTickRef.current = fitCanvasRequestTick;
        window.requestAnimationFrame(() => {
            fitCanvasToVisibleArea();
        });
    }, [fitCanvasRequestTick, fitCanvasToVisibleArea]);

    useEffect(() => {
        if (!pendingAutoLayoutFitRef.current) {
            return;
        }
        if (graph.nodes.length === 0 || rfNodes.length === 0) {
            pendingAutoLayoutFitRef.current = false;
            clearAutoLayoutFitFallbackTimer();
            return;
        }
        if (!canCompletePendingAutoLayoutFit()) {
            return;
        }
        completePendingAutoLayoutFit();
    }, [
        canCompletePendingAutoLayoutFit,
        clearAutoLayoutFitFallbackTimer,
        completePendingAutoLayoutFit,
        graph.nodes.length,
        rfNodes,
    ]);

    useEffect(() => {
        if (autoLayoutRequestTick <= 0 || autoLayoutRequestTick === handledAutoLayoutTickRef.current) {
            return;
        }
        handledAutoLayoutTickRef.current = autoLayoutRequestTick;
        let cancelled = false;
        const runAutoLayout = async () => {
            const autoLayoutPositions = await buildElkAutoLayout(graph, {
                nodeSizes: collectNodeSizesForLayout(),
            });
            if (cancelled) {
                return;
            }
            updateNodePositions((current) => ({
                ...current,
                ...autoLayoutPositions,
            }));
            notifyUser.success(t('graphEditor.status.autoLayoutDone'));
            pendingAutoLayoutFitRef.current = true;
            scheduleAutoLayoutFitFallback();
        };
        void runAutoLayout();
        return () => {
            cancelled = true;
        };
    }, [autoLayoutRequestTick, collectNodeSizesForLayout, graph, scheduleAutoLayoutFitFallback, t, updateNodePositions]);

    const resolveCopyCandidateNodeIds = useCallback((): string[] => {
        if (selectedNodeIds.length > 0) {
            return selectedNodeIds;
        }
        if (selectedNodeId) {
            return [selectedNodeId];
        }
        return [];
    }, [selectedNodeId, selectedNodeIds]);

    const duplicateSelectedNodes = useCallback((): boolean => {
        const copied = copyNodesToClipboard(resolveCopyCandidateNodeIds());
        if (!copied) {
            return false;
        }
        return pasteClipboardNodes();
    }, [copyNodesToClipboard, pasteClipboardNodes, resolveCopyCandidateNodeIds]);

    const contextMenuNode = useMemo(() => {
        if (!nodeContextMenu) {
            return null;
        }
        return graph.nodes.find((node) => node.node_id === nodeContextMenu.nodeId) ?? null;
    }, [graph.nodes, nodeContextMenu]);

    const contextMenuNodeSpec = useMemo(() => {
        if (!contextMenuNode) {
            return null;
        }
        return catalogByType.get(contextMenuNode.type_name) ?? null;
    }, [catalogByType, contextMenuNode]);

    const contextMenuAboutText = useMemo(() => {
        const rawDescription = contextMenuNodeSpec?.description;
        const typeName = contextMenuNodeSpec?.type_name;
        if (typeof rawDescription === 'string' && rawDescription.trim() && typeName) {
            return translateNodeTypeDescription(t, typeName, rawDescription.trim());
        }
        return t('graphEditor.contextMenu.aboutFallback');
    }, [contextMenuNodeSpec, t]);

    const nodeLibraryGroups = useMemo(() => {
        const isDataNode = (nodeType: NodeSpec): boolean => {
            return isVisibleDataLibraryType(nodeType.type_name);
        };
        const dataNodes = catalog.filter(isDataNode);
        const otherNodes = catalog.filter((nodeType) => !isDataNode(nodeType));
        return [
            {key: 'data', title: t('graphEditor.drawer.groups.data', {defaultValue: 'Data'}), items: dataNodes},
            {key: 'general', title: t('graphEditor.drawer.groups.general', {defaultValue: 'General'}), items: otherNodes},
        ].filter((group) => group.items.length > 0);
    }, [catalog, t]);

    const buildContextActionStyle = useCallback(
        (action: ContextMenuActionKey): CSSProperties => {
            const hovered = hoveredContextAction === action;
            const danger = action === 'delete';
            return {
                height: 32,
                border: 'none',
                borderRadius: 7,
                background: hovered ? (danger ? '#fef2f2' : '#f8fafc') : 'transparent',
                color: danger ? '#7f1d1d' : '#1f2937',
                fontSize: 14,
                fontWeight: danger ? 600 : 500,
                padding: '0 9px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
                transform: hovered ? 'translateX(1px)' : 'translateX(0)',
                transition: `background-color 140ms ${NON_LINEAR_EASE}, transform 140ms ${NON_LINEAR_EASE}, box-shadow 160ms ${NON_LINEAR_EASE}`,
                boxShadow: hovered
                    ? `inset 0 0 0 1px ${danger ? '#fecaca' : '#e2e8f0'}`
                    : 'none',
            };
        },
        [hoveredContextAction],
    );

    const buildZoomActionStyle = useCallback(
        (action: ZoomControlActionKey): CSSProperties => {
            const hovered = hoveredZoomAction === action;
            const active = action === 'ratio' && zoomMenuOpen;
            return {
                width: '100%',
                height: '100%',
                border: 'none',
                borderRadius: 0,
                background: active ? '#f1f5f9' : hovered ? '#f8fafc' : 'transparent',
                color: action === 'ratio' ? '#1f2937' : '#4b5563',
                cursor: 'pointer',
                fontWeight: action === 'ratio' ? 600 : 500,
                fontSize: action === 'ratio' ? 14 : 15,
                padding: 0,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: `background-color 140ms ${NON_LINEAR_EASE}, transform 140ms ${NON_LINEAR_EASE}`,
                transform: hovered || active ? 'translateY(-0.5px)' : 'translateY(0)',
            };
        },
        [hoveredZoomAction, zoomMenuOpen],
    );

    useEffect(() => {
        setSelectedNodeIds((current) =>
            current.filter((nodeId) => graph.nodes.some((node) => node.node_id === nodeId)),
        );
    }, [graph.nodes]);

    useEffect(() => {
        if (!nodeContextMenu) {
            return;
        }
        const closeMenu = () => {
            setNodeContextMenu(null);
        };
        const onEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setNodeContextMenu(null);
            }
        };
        window.addEventListener('click', closeMenu);
        window.addEventListener('keydown', onEscape);
        return () => {
            window.removeEventListener('click', closeMenu);
            window.removeEventListener('keydown', onEscape);
        };
    }, [nodeContextMenu]);

    useEffect(() => {
        if (!zoomMenuOpen) {
            return;
        }
        const closeOnPointerDownOutside = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) {
                return;
            }
            if (zoomControlRef.current?.contains(target)) {
                return;
            }
            setZoomMenuOpen(false);
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setZoomMenuOpen(false);
            }
        };
        window.addEventListener('pointerdown', closeOnPointerDownOutside);
        window.addEventListener('keydown', closeOnEscape);
        return () => {
            window.removeEventListener('pointerdown', closeOnPointerDownOutside);
            window.removeEventListener('keydown', closeOnEscape);
        };
    }, [setZoomMenuOpen, zoomMenuOpen]);

    useEffect(() => {
        if (!settingsOpen) {
            return;
        }
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setSettingsOpen(false);
            }
        };
        window.addEventListener('keydown', closeOnEscape);
        return () => {
            window.removeEventListener('keydown', closeOnEscape);
        };
    }, [settingsOpen]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (isEditableElement(event.target)) {
                return;
            }
            const commandPressed = event.metaKey || event.ctrlKey;
            const key = event.key.toLowerCase();
            if (commandPressed) {
                if (key === 'c') {
                    const copied = copyNodesToClipboard(resolveCopyCandidateNodeIds());
                    if (copied) {
                        event.preventDefault();
                        closeNodeContextMenu();
                    }
                    return;
                }
                if (key === 'v') {
                    const pasted = pasteClipboardNodes();
                    if (pasted) {
                        event.preventDefault();
                        closeNodeContextMenu();
                    }
                    return;
                }
                if (key === 'd') {
                    const duplicated = duplicateSelectedNodes();
                    if (duplicated) {
                        event.preventDefault();
                        closeNodeContextMenu();
                    }
                    return;
                }
            }
            if (event.key === 'Delete' || event.key === 'Backspace') {
                const targetNodeIds = resolveCopyCandidateNodeIds();
                if (targetNodeIds.length > 0) {
                    deleteNodesByIds(targetNodeIds);
                    event.preventDefault();
                    closeNodeContextMenu();
                }
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [
        closeNodeContextMenu,
        copyNodesToClipboard,
        deleteNodesByIds,
        duplicateSelectedNodes,
        pasteClipboardNodes,
        resolveCopyCandidateNodeIds,
    ]);

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
                notifyUser.warning(t('graphEditor.errors.invalidConnection'));
                return;
            }
            if (!canBindTargetPort(rfEdges, connection.target, connection.targetHandle)) {
                notifyUser.warning(t('graphEditor.errors.targetPortDuplicate'));
                return;
            }

            const sourcePort = connection.sourceHandle.slice(SOURCE_HANDLE_PREFIX.length);
            const targetPort = connection.targetHandle.slice(TARGET_HANDLE_PREFIX.length);
            const outputPort = resolveOutputPort(connection.source, sourcePort);
            const inputPort = resolveInputPort(connection.target, targetPort);
            if (!outputPort || !inputPort) {
                notifyUser.warning(t('graphEditor.errors.invalidConnection'));
                return;
            }
            if (!isSchemaCompatible(outputPort.frame_schema, inputPort.frame_schema)) {
                notifyUser.warning(
                    t('graphEditor.errors.schemaMismatch', {
                        sourceType: simplifyFrameSchema(outputPort.frame_schema),
                        targetType: simplifyFrameSchema(inputPort.frame_schema),
                    }),
                );
                return;
            }

            const edgeId = buildEdgeId(connection.source, sourcePort, connection.target, targetPort);
            const edgeColor = getSchemaColor(outputPort.frame_schema);
            const nextEdge: Edge = {
                id: edgeId,
                source: connection.source,
                sourceHandle: connection.sourceHandle,
                target: connection.target,
                targetHandle: connection.targetHandle,
                markerEnd: {type: MarkerType.ArrowClosed, color: edgeColor},
                style: {
                    stroke: edgeColor,
                    strokeWidth: 2,
                },
            };

            setRfEdges((current) => {
                const next = [...current, nextEdge];
                syncEdgesToStore(next);
                return next;
            });
        },
        [resolveInputPort, resolveOutputPort, rfEdges, setRfEdges, syncEdgesToStore, t],
    );

    const onConnectStart = useCallback(
        (_event: ReactMouseEvent | ReactTouchEvent, params: OnConnectStartParams) => {
            setActiveConnectionColor(
                resolveConnectionColor(
                    params.nodeId,
                    params.handleId,
                    params.handleType === 'source' || params.handleType === 'target'
                        ? params.handleType
                        : null,
                ),
            );
        },
        [resolveConnectionColor],
    );

    const onConnectEnd = useCallback(() => {
        setActiveConnectionColor(DEFAULT_EDGE_COLOR);
    }, []);

    const onEdgeClick = useCallback(
        (event: ReactMouseEvent, edge: Edge) => {
            event.preventDefault();
            event.stopPropagation();
            setRfEdges((current) => {
                const next = current.filter((item) => item.id !== edge.id);
                syncEdgesToStore(next);
                return next;
            });
        },
        [setRfEdges, syncEdgesToStore],
    );

    const onNodesDelete = useCallback(
        (nodes: Node[]) => {
            deleteNodesByIds(nodes.map((node) => node.id));
        },
        [deleteNodesByIds],
    );

    const onNodeDragStop = useCallback(
        (_event: unknown, node: Node) => {
            updateNodePositions((current) => ({
                ...current,
                [node.id]: node.position,
            }));
        },
        [updateNodePositions],
    );

    const onNodeClick = useCallback(
        (_event: unknown, node: Node) => {
            selectNode(node.id);
            setSelectedNodeIds([node.id]);
            closeNodeContextMenu();
        },
        [closeNodeContextMenu, selectNode],
    );

    const onNodeContextMenu = useCallback(
        (event: ReactMouseEvent, node: Node) => {
            event.preventDefault();
            event.stopPropagation();
            setSelectedNodeIds((current) => {
                if (current.length > 1 && current.includes(node.id)) {
                    return current;
                }
                return [node.id];
            });
            setHoveredContextAction(null);
            setNodeContextMenu({
                nodeId: node.id,
                x: event.clientX,
                y: event.clientY,
            });
        },
        [],
    );

    const onPaneClick = useCallback(() => {
        selectNode(null);
        setSelectedNodeIds([]);
        closeNodeContextMenu();
    }, [closeNodeContextMenu, selectNode]);

    const onSelectionChange = useCallback(
        ({nodes}: { nodes: Node[] }) => {
            if (nodes.length === 0) {
                setSelectedNodeIds([]);
                return;
            }
            setSelectedNodeIds(nodes.map((node) => node.id));
        },
        [],
    );

    const runContextDelete = useCallback(() => {
        if (!nodeContextMenu) {
            return;
        }
        deleteNodesByIds(resolveNodeIdsForAction(nodeContextMenu.nodeId));
        closeNodeContextMenu();
    }, [closeNodeContextMenu, deleteNodesByIds, nodeContextMenu, resolveNodeIdsForAction]);

    const runContextCopy = useCallback(() => {
        if (!nodeContextMenu) {
            return;
        }
        copyNodesToClipboard(resolveNodeIdsForAction(nodeContextMenu.nodeId));
        closeNodeContextMenu();
    }, [closeNodeContextMenu, copyNodesToClipboard, nodeContextMenu, resolveNodeIdsForAction]);

    const runContextDuplicate = useCallback(() => {
        if (!nodeContextMenu) {
            return;
        }
        const actionNodeIds = resolveNodeIdsForAction(nodeContextMenu.nodeId);
        const copied = copyNodesToClipboard(actionNodeIds);
        if (copied) {
            pasteClipboardNodes();
        }
        closeNodeContextMenu();
    }, [
        closeNodeContextMenu,
        copyNodesToClipboard,
        nodeContextMenu,
        pasteClipboardNodes,
        resolveNodeIdsForAction,
    ]);

    const onCanvasContextMenu = useCallback(
        (event: ReactMouseEvent<HTMLDivElement>) => {
            event.preventDefault();
            closeNodeContextMenu();
        },
        [closeNodeContextMenu],
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
        const currentZoom = safeZoomRatio(zoomRatio);
        const nextZoom = safeZoomRatio(Number((currentZoom + delta).toFixed(2)), currentZoom);
        const viewport = reactFlow.getViewport();
        reactFlow.setViewport(
            {
                x: safeViewportAxis(viewport.x),
                y: safeViewportAxis(viewport.y),
                zoom: nextZoom,
            },
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
                    aria-label={t('graphEditor.quick.add')}
                    style={quickToolButtonStyle}
                    onClick={() => setNodeLibraryOpen(true)}
                >
                    <Plus size={16} aria-hidden="true"/>
                </button>
                <div aria-hidden="true" style={quickToolDividerStyle}/>
                <button
                    type="button"
                    title={t('graphEditor.quick.pointer')}
                    aria-label={t('graphEditor.quick.pointer')}
                    onClick={() => setEditorMode('pointer')}
                    style={{
                        ...quickToolButtonStyle,
                        borderColor: editorMode === 'pointer' ? '#93c5fd' : '#d6deeb',
                        background: editorMode === 'pointer' ? '#eff6ff' : '#ffffff',
                        color: editorMode === 'pointer' ? '#1d4ed8' : '#475569',
                    }}
                >
                    <MousePointer2 size={16} aria-hidden="true"/>
                </button>
                <button
                    type="button"
                    title={t('graphEditor.quick.hand')}
                    aria-label={t('graphEditor.quick.hand')}
                    onClick={() => setEditorMode('hand')}
                    style={{
                        ...quickToolButtonStyle,
                        borderColor: editorMode === 'hand' ? '#93c5fd' : '#d6deeb',
                        background: editorMode === 'hand' ? '#eff6ff' : '#ffffff',
                        color: editorMode === 'hand' ? '#1d4ed8' : '#475569',
                    }}
                >
                    <Hand size={16} aria-hidden="true"/>
                </button>
                <div aria-hidden="true" style={quickToolDividerStyle}/>
                <button
                    type="button"
                    title={t('graphEditor.quick.arrange')}
                    aria-label={t('graphEditor.quick.arrange')}
                    style={quickToolButtonStyle}
                    onClick={() => useUiStore.getState().requestAutoLayout()}
                >
                    <LayoutGrid size={16} aria-hidden="true"/>
                </button>
                <button
                    type="button"
                    title={t('graphEditor.quick.fit')}
                    aria-label={t('graphEditor.quick.fit')}
                    style={quickToolButtonStyle}
                    onClick={requestFitCanvas}
                >
                    <Expand size={16} aria-hidden="true"/>
                </button>
                <div aria-hidden="true" style={quickToolDividerStyle}/>
                <button
                    type="button"
                    title={t('graphEditor.quick.settings')}
                    aria-label={t('graphEditor.quick.settings')}
                    style={quickToolButtonStyle}
                    onClick={() => setSettingsOpen(true)}
                >
                    <Settings size={16} aria-hidden="true"/>
                </button>
            </aside>

            <SettingsDialog
                open={settingsOpen}
                currentLanguage={currentLanguage}
                onClose={() => setSettingsOpen(false)}
                onLanguageChange={handleLanguageChange}
            />

            {nodeLibraryOpen && (
                <aside
                    aria-label="node-library-drawer"
                    style={{
                        position: 'absolute',
                        left: 56,
                        top: NODE_LIBRARY_TOP_INSET,
                        bottom: NODE_LIBRARY_BOTTOM_INSET,
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
                        <button
                            type="button"
                            style={nodeLibraryCloseButtonStyle}
                            aria-label="Close node library"
                            onClick={() => setNodeLibraryOpen(false)}
                        >
                            <X size={14} strokeWidth={2.1} aria-hidden="true"/>
                        </button>
                    </div>
                    <div style={{fontSize: 12, opacity: 0.75, marginTop: 6}}>
                        {t('graphEditor.drawer.tip')}
                    </div>
                    <div style={{marginTop: 10, display: 'grid', gap: 10}}>
                        {nodeLibraryGroups.map((group) => (
                            <section key={group.key} style={{display: 'grid', gap: 8}}>
                                <div style={{fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase'}}>
                                    {group.title}
                                </div>
                                {group.items.map((nodeType) => (
                                    <article
                                        key={nodeType.type_name}
                                        draggable
                                        onClick={() => {
                                            addNodeAt(nodeType.type_name);
                                            setNodeLibraryOpen(false);
                                        }}
                                        onDragStart={(event) => {
                                            event.dataTransfer.setData('application/x-starry-node-type', nodeType.type_name);
                                        }}
                                        style={{
                                            border: nodeType.mode === 'passive' ? '1px dashed #f59e0b' : '1px solid #dce3ee',
                                            borderRadius: 12,
                                            padding: 8,
                                            background: nodeType.mode === 'passive' ? '#fffbeb' : '#fff',
                                            cursor: 'pointer',
                                        }}
                                    >
                                        <div style={{fontWeight: 700, fontSize: 13}}>{nodeType.type_name}</div>
                                        <div style={{display: 'grid', gap: 10, marginTop: 8, minWidth: 0}}>
                                            <DrawerPortSection
                                                nodeTypeName={nodeType.type_name}
                                                prefix="in"
                                                ports={nodeType.inputs ?? EMPTY_PORTS}
                                            />
                                            <DrawerPortSection
                                                nodeTypeName={nodeType.type_name}
                                                prefix="out"
                                                ports={nodeType.outputs ?? EMPTY_PORTS}
                                            />
                                        </div>
                                    </article>
                                ))}
                            </section>
                        ))}
                    </div>
                </aside>
            )}

            <div
                ref={canvasViewportRef}
                style={{position: 'absolute', inset: 0}}
                onDrop={onDropCanvas}
                onDragOver={onDragOverCanvas}
                onContextMenu={onCanvasContextMenu}
            >
                <ReactFlow
                    nodes={rfNodes}
                    edges={rfEdges}
                    nodeTypes={nodeTypes}
                    onNodesChange={handleNodesChange}
                    onEdgesChange={handleEdgesChange}
                    onConnect={onConnect}
                    onConnectStart={onConnectStart}
                    onConnectEnd={onConnectEnd}
                    onNodesDelete={onNodesDelete}
                    onEdgeClick={onEdgeClick}
                    onNodeDragStop={onNodeDragStop}
                    onNodeClick={onNodeClick}
                    onNodeContextMenu={onNodeContextMenu}
                    onSelectionChange={onSelectionChange}
                    onPaneClick={onPaneClick}
                    onMoveEnd={(_event, viewport) => {
                        setZoomRatio(safeZoomRatio(viewport.zoom));
                    }}
                    fitView={rfNodes.length > 0}
                    fitViewOptions={{padding: 0.2}}
                    panOnDrag={isHandMode}
                    panOnScroll={isHandMode}
                    nodesDraggable
                    selectionOnDrag={!isHandMode}
                    selectionMode={SelectionMode.Partial}
                    connectionLineStyle={{
                        stroke: activeConnectionColor,
                        strokeWidth: 2,
                    }}
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
                            bottom: 12 + ZOOM_HUD_HEIGHT + MINIMAP_GAP,
                            margin: 0,
                            borderRadius: 12,
                            border: '1px solid #dce3ee',
                            boxShadow: '0 14px 24px rgba(15, 23, 42, 0.08)',
                            background: 'rgba(255, 255, 255, 0.96)',
                            transition: BOTTOM_RIGHT_SHIFT_TRANSITION,
                        }}
                    />
                </ReactFlow>
            </div>

            {nodeContextMenu && (
                <div
                    role="menu"
                    aria-label="node-context-menu"
                    style={{
                        position: 'fixed',
                        top: nodeContextMenu.y,
                        left: nodeContextMenu.x,
                        zIndex: 14,
                        minWidth: 198,
                        padding: 6,
                        borderRadius: 10,
                        border: '1px solid #dce3ee',
                        background: '#ffffff',
                        boxShadow: '0 1px 2px rgba(15, 23, 42, 0.08), 0 8px 18px rgba(15, 23, 42, 0.1), 0 16px 28px rgba(15, 23, 42, 0.04)',
                        display: 'grid',
                        gap: 2,
                    }}
                    onClick={(event) => {
                        event.stopPropagation();
                    }}
                >
                    <button
                        type="button"
                        className="button-hover-exempt"
                        onClick={runContextCopy}
                        style={buildContextActionStyle('copy')}
                        onMouseEnter={() => setHoveredContextAction('copy')}
                        onMouseLeave={() => setHoveredContextAction(null)}
                    >
                        <span>{t('graphEditor.contextMenu.copy')}</span>
                        <span style={{fontSize: 12, color: '#6b7280'}}>{`${shortcutModifierLabel} C`}</span>
                    </button>
                    <button
                        type="button"
                        className="button-hover-exempt"
                        onClick={runContextDuplicate}
                        style={buildContextActionStyle('duplicate')}
                        onMouseEnter={() => setHoveredContextAction('duplicate')}
                        onMouseLeave={() => setHoveredContextAction(null)}
                    >
                        <span>{t('graphEditor.contextMenu.duplicate')}</span>
                        <span style={{fontSize: 12, color: '#6b7280'}}>{`${shortcutModifierLabel} D`}</span>
                    </button>
                    <div style={{height: 1, background: '#dde2eb', margin: '4px 4px'}}/>
                    <button
                        type="button"
                        className="button-hover-exempt"
                        onClick={runContextDelete}
                        style={buildContextActionStyle('delete')}
                        onMouseEnter={() => setHoveredContextAction('delete')}
                        onMouseLeave={() => setHoveredContextAction(null)}
                    >
                        <span>{t('graphEditor.contextMenu.delete')}</span>
                        <span style={{fontSize: 12, color: '#6b7280'}}>Del</span>
                    </button>
                    <div style={{height: 1, background: '#dde2eb', margin: '4px 4px'}}/>
                    <div style={{padding: '3px 9px 7px'}}>
                        <div style={{fontSize: 12, color: '#64748b', marginBottom: 2}}>
                            {t('graphEditor.contextMenu.about')}
                        </div>
                        <div style={{fontSize: 12, color: '#0f172a', fontWeight: 600, marginBottom: 2}}>
                            {contextMenuNode?.type_name ?? t('common.none')}
                        </div>
                        <div style={{fontSize: 11, color: '#334155', lineHeight: 1.4}}>
                            {contextMenuAboutText}
                        </div>
                    </div>
                </div>
            )}

            <div
                ref={zoomControlRef}
                style={{
                    position: 'absolute',
                    right: 12 + bottomRightOffset,
                    bottom: 12,
                    zIndex: 7,
                    width: ZOOM_BAR_WIDTH,
                    transition: BOTTOM_RIGHT_SHIFT_TRANSITION,
                }}
            >
                <div
                    data-testid="zoom-control-bar"
                    style={{
                        height: ZOOM_BAR_HEIGHT,
                        border: '1px solid #dce3ee',
                        borderRadius: 12,
                        boxShadow: '0 1px 2px rgba(15, 23, 42, 0.08), 0 8px 18px rgba(15, 23, 42, 0.1)',
                        background: '#ffffff',
                        display: 'grid',
                        gridTemplateColumns: `1fr ${ZOOM_BAR_RATIO_WIDTH}px 1fr`,
                        alignItems: 'stretch',
                        overflow: 'hidden',
                    }}
                >
                    <button
                        type="button"
                        className="button-hover-exempt"
                        title={t('graphEditor.zoom.decrease')}
                        onClick={() => applyZoomDelta(-0.1)}
                        style={{
                            ...buildZoomActionStyle('decrease'),
                            borderRight: '1px solid #e2e8f0',
                        }}
                        onMouseEnter={() => setHoveredZoomAction('decrease')}
                        onMouseLeave={() => setHoveredZoomAction(null)}
                    >
                        <Minus size={15} strokeWidth={2.2}/>
                    </button>
                    <button
                        type="button"
                        className="button-hover-exempt"
                        data-testid="zoom-ratio-button"
                        onClick={() => setZoomMenuOpen(!zoomMenuOpen)}
                        style={buildZoomActionStyle('ratio')}
                        onMouseEnter={() => setHoveredZoomAction('ratio')}
                        onMouseLeave={() => setHoveredZoomAction(null)}
                    >
                        {Math.round(zoomRatio * 100)}%
                    </button>
                    <button
                        type="button"
                        className="button-hover-exempt"
                        title={t('graphEditor.zoom.increase')}
                        onClick={() => applyZoomDelta(0.1)}
                        style={{
                            ...buildZoomActionStyle('increase'),
                            borderLeft: '1px solid #e2e8f0',
                        }}
                        onMouseEnter={() => setHoveredZoomAction('increase')}
                        onMouseLeave={() => setHoveredZoomAction(null)}
                    >
                        <Plus size={15} strokeWidth={2.2}/>
                    </button>
                </div>
                {zoomMenuOpen && (
                    <div
                        style={{
                            border: '1px solid #dce3ee',
                            borderRadius: 10,
                            background: '#ffffff',
                            boxShadow:
                                '0 1px 2px rgba(15, 23, 42, 0.08), 0 8px 18px rgba(15, 23, 42, 0.1), 0 16px 28px rgba(15, 23, 42, 0.04)',
                            padding: 6,
                            display: 'grid',
                            gap: 2,
                            position: 'absolute',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            bottom: ZOOM_BAR_HEIGHT + 8,
                            minWidth: 120,
                        }}
                    >
                        {ZOOM_PRESETS.map((preset) => (
                            <div key={preset}>
                                <button
                                    type="button"
                                    className="button-hover-exempt"
                                    onClick={() => {
                                        const viewport = reactFlow.getViewport();
                                        const nextZoom = safeZoomRatio(preset);
                                        reactFlow.setViewport({
                                            x: safeViewportAxis(viewport.x),
                                            y: safeViewportAxis(viewport.y),
                                            zoom: nextZoom,
                                        });
                                        setZoomRatio(nextZoom);
                                        setZoomMenuOpen(false);
                                    }}
                                    onMouseEnter={() => setHoveredZoomPreset(preset)}
                                    onMouseLeave={() => setHoveredZoomPreset(null)}
                                    style={{
                                        height: 32,
                                        width: '100%',
                                        border: 'none',
                                        borderRadius: 7,
                                        background:
                                            Math.round(preset * 100) === Math.round(zoomRatio * 100)
                                                ? '#f1f5f9'
                                                : hoveredZoomPreset === preset
                                                  ? '#f8fafc'
                                                  : 'transparent',
                                        color: '#1f2937',
                                        fontSize: 14,
                                        fontWeight: Math.round(preset * 100) === Math.round(zoomRatio * 100) ? 600 : 500,
                                        lineHeight: 1,
                                        textAlign: 'left',
                                        padding: '0 10px',
                                        cursor: 'pointer',
                                        transition: `background-color 140ms ${NON_LINEAR_EASE}, transform 140ms ${NON_LINEAR_EASE}, box-shadow 160ms ${NON_LINEAR_EASE}`,
                                        transform: hoveredZoomPreset === preset ? 'translateX(1px)' : 'translateX(0)',
                                        boxShadow:
                                            hoveredZoomPreset === preset
                                                ? 'inset 0 0 0 1px #e2e8f0'
                                                : 'none',
                                    }}
                                >
                                    {Math.round(preset * 100)}%
                                </button>
                                {preset !== ZOOM_PRESETS[ZOOM_PRESETS.length - 1] && (
                                    <div style={{height: 1, background: '#e2e8f0', margin: '2px 4px 0'}}/>
                                )}
                            </div>
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
