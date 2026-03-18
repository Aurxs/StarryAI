import ELK, {type ElkExtendedEdge, type ElkNode, type ElkPort} from 'elkjs/lib/elk.bundled.js';
import type {Edge, XYPosition} from 'reactflow';

import type {
    EdgeSpec,
    GraphSpec,
    NodeInstanceSpec,
    NodeSpec,
    PortSpec,
    ValidationIssue,
} from '../../entities/workbench/types';

export const SOURCE_HANDLE_PREFIX = 'out:';
export const TARGET_HANDLE_PREFIX = 'in:';
export const UI_LAYOUT_METADATA_KEY = 'ui_layout';
export const NODE_POSITIONS_METADATA_KEY = 'node_positions';

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const toFiniteNumber = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    return null;
};

export const buildEdgeId = (
    sourceNode: string,
    sourcePort: string,
    targetNode: string,
    targetPort: string,
): string => `${sourceNode}.${sourcePort}->${targetNode}.${targetPort}`;

export const extractPortFromHandle = (
    handle: string | null | undefined,
    prefix: typeof SOURCE_HANDLE_PREFIX | typeof TARGET_HANDLE_PREFIX,
): string | null => {
    if (!handle || !handle.startsWith(prefix)) {
        return null;
    }
    const port = handle.slice(prefix.length).trim();
    return port || null;
};

export const canBindTargetPort = (
    edges: Array<Pick<Edge, 'target' | 'targetHandle'>>,
    targetNodeId: string,
    targetHandle: string,
): boolean =>
    !edges.some((edge) => edge.target === targetNodeId && edge.targetHandle === targetHandle);

export const isSchemaCompatible = (sourceSchema: string, targetSchema: string): boolean => {
    const source = sourceSchema.trim().toLowerCase();
    const target = targetSchema.trim().toLowerCase();
    if (source === 'none' || target === 'none') {
        return false;
    }
    if (source === 'any' || target === 'any') {
        return true;
    }
    const sourceSync = source.endsWith('.sync');
    const targetSync = target.endsWith('.sync');
    if (sourceSync !== targetSync) {
        return false;
    }
    if (sourceSync && targetSync) {
        const sourceBase = source.slice(0, -'.sync'.length);
        const targetBase = target.slice(0, -'.sync'.length);
        return sourceBase === 'any' || targetBase === 'any' || sourceBase === targetBase;
    }
    return source === target;
};

const normalizeSchema = (schema: string): string => schema.trim().toLowerCase();
const isSyncSchema = (schema: string): boolean => normalizeSchema(schema).endsWith('.sync');
const baseSchema = (schema: string): string => {
    const normalized = normalizeSchema(schema);
    return isSyncSchema(normalized) ? normalized.slice(0, -'.sync'.length) : normalized;
};
const toSyncSchema = (schema: string): string => {
    const normalized = baseSchema(schema);
    if (!normalized || normalized === 'any') {
        return 'any.sync';
    }
    return `${normalized}.sync`;
};

const resolveDataContainerOutputSchema = (
    node: NodeInstanceSpec,
    outputPort: PortSpec,
): string => {
    if (outputPort.name !== 'value') {
        return normalizeSchema(outputPort.frame_schema);
    }
    if (node.type_name === 'data.constant' || node.type_name === 'data.variable') {
        const valueType = typeof node.config.value_type === 'string' ? node.config.value_type.trim().toLowerCase() : '';
        if (valueType === 'float') {
            return 'scalar.float';
        }
        if (valueType === 'string') {
            return 'scalar.string';
        }
        return 'scalar.int';
    }
    return normalizeSchema(outputPort.frame_schema);
};

export const simplifyFrameSchema = (schema: string): string => {
    const normalized = schema.trim().toLowerCase();
    if (!normalized) {
        return 'unknown';
    }
    if (normalized === 'any') {
        return 'any';
    }
    if (normalized === 'none') {
        return 'none';
    }
    if (normalized === 'scalar.int') {
        return 'int';
    }
    if (normalized === 'scalar.float') {
        return 'float';
    }
    if (normalized === 'scalar.string') {
        return 'string';
    }
    if (normalized === 'json.list') {
        return 'list';
    }
    if (normalized === 'json.dict') {
        return 'dict';
    }
    if (normalized === 'json.any') {
        return 'json';
    }
    if (isSyncSchema(normalized)) {
        const syncBase = baseSchema(normalized);
        const [head] = syncBase.split('.');
        const resolvedHead = head || syncBase || 'sync';
        return `${resolvedHead}.sync`;
    }
    const [head] = normalized.split('.');
    return head || normalized;
};

export const getSchemaColor = (schema: string): string => {
    const normalized = normalizeSchema(schema);
    const root = (() => {
        if (normalized === 'any') {
            return 'any';
        }
        if (normalized === 'none') {
            return 'none';
        }
        const noSync = isSyncSchema(normalized) ? baseSchema(normalized) : normalized;
        const [head] = noSync.split('.');
        return head || noSync;
    })();
    switch (root) {
        case 'text':
            return '#3b82f6';
        case 'audio':
            return '#16a34a';
        case 'motion':
            return '#f97316';
        case 'scalar':
            return '#0f766e';
        case 'json':
            return '#c2410c';
        case 'sync':
            return '#0891b2';
        case 'any':
            return '#64748b';
        case 'none':
            return '#94a3b8';
        default:
            return '#8b5cf6';
    }
};

export interface ResolvedGraphPortSchemas {
    inputs: Record<string, Record<string, string>>;
    outputs: Record<string, Record<string, string>>;
}

const buildGraphAdjacency = (graph: GraphSpec): {
    incoming: Record<string, EdgeSpec[]>;
    outgoing: Record<string, EdgeSpec[]>;
} => {
    const incoming: Record<string, EdgeSpec[]> = {};
    const outgoing: Record<string, EdgeSpec[]> = {};
    for (const node of graph.nodes) {
        incoming[node.node_id] = [];
        outgoing[node.node_id] = [];
    }
    for (const edge of graph.edges) {
        if (!outgoing[edge.source_node] || !incoming[edge.target_node]) {
            continue;
        }
        outgoing[edge.source_node].push(edge);
        incoming[edge.target_node].push(edge);
    }
    return {incoming, outgoing};
};

const buildTopologicalOrder = (graph: GraphSpec, outgoing: Record<string, EdgeSpec[]>): string[] => {
    const indegree = new Map<string, number>();
    for (const node of graph.nodes) {
        indegree.set(node.node_id, 0);
    }
    for (const sourceEdges of Object.values(outgoing)) {
        for (const edge of sourceEdges) {
            indegree.set(edge.target_node, (indegree.get(edge.target_node) ?? 0) + 1);
        }
    }
    const queue: string[] = [];
    for (const [nodeId, degree] of indegree.entries()) {
        if (degree === 0) {
            queue.push(nodeId);
        }
    }
    const order: string[] = [];
    while (queue.length > 0) {
        const current = queue.shift();
        if (!current) {
            continue;
        }
        order.push(current);
        for (const edge of outgoing[current] ?? []) {
            const nextDegree = (indegree.get(edge.target_node) ?? 0) - 1;
            indegree.set(edge.target_node, nextDegree);
            if (nextDegree === 0) {
                queue.push(edge.target_node);
            }
        }
    }
    for (const node of graph.nodes) {
        if (!order.includes(node.node_id)) {
            order.push(node.node_id);
        }
    }
    return order;
};

const resolveDynamicOutputSchema = (
    node: NodeInstanceSpec,
    outputPort: PortSpec,
    dynamicInputSchemas: Record<string, string>,
): string => {
    if (!outputPort.derived_from_input) {
        return resolveDataContainerOutputSchema(node, outputPort);
    }
    const sourceInputSchema = dynamicInputSchemas[outputPort.derived_from_input] ?? 'any';
    if (isSyncSchema(outputPort.frame_schema)) {
        return toSyncSchema(baseSchema(sourceInputSchema));
    }
    return normalizeSchema(baseSchema(sourceInputSchema));
};

export const resolveGraphPortSchemas = (
    graph: GraphSpec,
    catalogByType: Map<string, NodeSpec>,
): ResolvedGraphPortSchemas => {
    const {incoming, outgoing} = buildGraphAdjacency(graph);
    const order = buildTopologicalOrder(graph, outgoing);
    const inputs: Record<string, Record<string, string>> = {};
    const outputs: Record<string, Record<string, string>> = {};

    for (const nodeId of order) {
        const node = graph.nodes.find((item) => item.node_id === nodeId);
        if (!node) {
            continue;
        }
        const spec = catalogByType.get(node.type_name);
        if (!spec) {
            inputs[nodeId] = {};
            outputs[nodeId] = {};
            continue;
        }
        const inputPorts = Array.isArray(spec.inputs) ? spec.inputs : [];
        const outputPorts = Array.isArray(spec.outputs) ? spec.outputs : [];
        const inputSchemas: Record<string, string> = {};
        const dynamicInputSchemas: Record<string, string> = {};
        for (const inputPort of inputPorts) {
            const declaredSchema = normalizeSchema(inputPort.frame_schema);
            const matchedEdge = (incoming[nodeId] ?? []).find((edge) => edge.target_port === inputPort.name);
            let dynamicSchema = declaredSchema;
            if (matchedEdge && (declaredSchema === 'any' || declaredSchema === 'any.sync')) {
                const upstreamSchema = outputs[matchedEdge.source_node]?.[matchedEdge.source_port];
                if (upstreamSchema) {
                    dynamicSchema = upstreamSchema;
                }
            }
            inputSchemas[inputPort.name] = dynamicSchema;
            dynamicInputSchemas[inputPort.name] = dynamicSchema;
        }
        inputs[nodeId] = inputSchemas;

        const outputSchemas: Record<string, string> = {};
        for (const outputPort of outputPorts) {
            outputSchemas[outputPort.name] = resolveDynamicOutputSchema(node, outputPort, dynamicInputSchemas);
        }
        outputs[nodeId] = outputSchemas;
    }

    for (const node of graph.nodes) {
        if (inputs[node.node_id] && outputs[node.node_id]) {
            continue;
        }
        const spec = catalogByType.get(node.type_name);
        if (!spec) {
            inputs[node.node_id] = {};
            outputs[node.node_id] = {};
            continue;
        }
        const inputPorts = Array.isArray(spec.inputs) ? spec.inputs : [];
        const outputPorts = Array.isArray(spec.outputs) ? spec.outputs : [];
        inputs[node.node_id] = Object.fromEntries(
            inputPorts.map((port) => [port.name, normalizeSchema(port.frame_schema)]),
        );
        outputs[node.node_id] = Object.fromEntries(
            outputPorts.map((port) => [port.name, resolveDataContainerOutputSchema(node, port)]),
        );
    }

    return {inputs, outputs};
};

export const edgeToSpec = (edge: Pick<Edge, 'source' | 'sourceHandle' | 'target' | 'targetHandle'>): EdgeSpec | null => {
    const sourcePort = extractPortFromHandle(edge.sourceHandle, SOURCE_HANDLE_PREFIX);
    const targetPort = extractPortFromHandle(edge.targetHandle, TARGET_HANDLE_PREFIX);
    if (!sourcePort || !targetPort) {
        return null;
    }
    return {
        source_node: edge.source,
        source_port: sourcePort,
        target_node: edge.target,
        target_port: targetPort,
        queue_maxsize: 0,
    };
};

export interface ValidationTargets {
    nodeIds: Set<string>;
    edgeIds: Set<string>;
}

const cloneValue = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const cloneNode = (node: NodeInstanceSpec): NodeInstanceSpec => ({
    ...node,
    config: cloneValue(node.config),
});

const cloneEdge = (edge: EdgeSpec): EdgeSpec => ({...edge});

const DEFAULT_POSITION: XYPosition = {x: 0, y: 0};
const DEFAULT_LAYOUT_NODE_WIDTH = 210;
const DEFAULT_LAYOUT_NODE_HEIGHT = 124;
const DEFAULT_LAYER_SPACING = 64;
const DEFAULT_NODE_SPACING = 48;

interface ElkAutoLayoutOptions {
    startX?: number;
    startY?: number;
    nodeWidth?: number;
    nodeHeight?: number;
    layerSpacing?: number;
    nodeSpacing?: number;
    nodeSizes?: Record<string, {width: number; height: number}>;
}

interface CollectedPorts {
    input: Set<string>;
    output: Set<string>;
}

const comparePortNames = (left: string, right: string): number =>
    left.localeCompare(right, undefined, {numeric: true, sensitivity: 'base'});
const isPositiveFiniteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0;

const collectNodePorts = (graph: GraphSpec): Map<string, CollectedPorts> => {
    const collected = new Map<string, CollectedPorts>();
    for (const node of graph.nodes) {
        collected.set(node.node_id, {
            input: new Set<string>(),
            output: new Set<string>(),
        });
    }
    for (const edge of graph.edges) {
        collected.get(edge.source_node)?.output.add(edge.source_port);
        collected.get(edge.target_node)?.input.add(edge.target_port);
    }
    return collected;
};

const buildLayerGroups = (graph: GraphSpec): {layers: Map<string, number>; groups: Map<number, string[]>} => {
    const {incoming, outgoing} = buildGraphAdjacency(graph);
    const order = buildTopologicalOrder(graph, outgoing);
    const layers = new Map<string, number>();
    for (const nodeId of order) {
        const parentLayers = (incoming[nodeId] ?? [])
            .map((edge) => layers.get(edge.source_node) ?? 0);
        layers.set(nodeId, parentLayers.length > 0 ? Math.max(...parentLayers) + 1 : 0);
    }
    const groups = new Map<number, string[]>();
    for (const nodeId of order) {
        const layer = layers.get(nodeId) ?? 0;
        if (!groups.has(layer)) {
            groups.set(layer, []);
        }
        groups.get(layer)?.push(nodeId);
    }
    return {layers, groups};
};

const buildTargetPortOrder = (graph: GraphSpec): Map<string, Map<string, number>> => {
    const targetPorts = new Map<string, Set<string>>();
    for (const edge of graph.edges) {
        if (!targetPorts.has(edge.target_node)) {
            targetPorts.set(edge.target_node, new Set<string>());
        }
        targetPorts.get(edge.target_node)?.add(edge.target_port);
    }
    const targetPortOrder = new Map<string, Map<string, number>>();
    for (const [targetNodeId, portSet] of targetPorts.entries()) {
        const sortedPorts = [...portSet].sort(comparePortNames);
        const orderMap = new Map<string, number>();
        sortedPorts.forEach((portName, index) => {
            orderMap.set(portName, index);
        });
        targetPortOrder.set(targetNodeId, orderMap);
    }
    return targetPortOrder;
};

const applyPortAwareLayerOrdering = (
    graph: GraphSpec,
    positions: Record<string, XYPosition>,
    nodeHeights: Record<string, number>,
    fallbackNodeHeight: number,
): Record<string, XYPosition> => {
    const {layers, groups} = buildLayerGroups(graph);
    const targetPortOrder = buildTargetPortOrder(graph);
    const nextPositions: Record<string, XYPosition> = {...positions};

    const maxLayer = Math.max(...groups.keys(), 0);
    for (let layer = 0; layer <= maxLayer; layer += 1) {
        const layerNodes = groups.get(layer) ?? [];
        if (layerNodes.length < 2) {
            continue;
        }

        const slotYs = layerNodes
            .map((nodeId) => nextPositions[nodeId]?.y)
            .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
            .sort((left, right) => left - right);
        if (slotYs.length !== layerNodes.length) {
            continue;
        }

        const nodeScores = layerNodes.map((nodeId) => {
            const currentY = nextPositions[nodeId]?.y ?? 0;
            const contributions = graph.edges
                .filter((edge) => edge.source_node === nodeId)
                .map((edge) => {
                    const targetLayer = layers.get(edge.target_node) ?? layer;
                    if (targetLayer <= layer) {
                        return null;
                    }
                    const targetY = nextPositions[edge.target_node]?.y;
                    if (typeof targetY !== 'number' || !Number.isFinite(targetY)) {
                        return null;
                    }
                    const portOrder = targetPortOrder.get(edge.target_node);
                    const portRank = portOrder?.get(edge.target_port) ?? 0;
                    const portCount = Math.max(1, portOrder?.size ?? 1);
                    const targetNodeHeight = nodeHeights[edge.target_node] ?? fallbackNodeHeight;
                    const normalizedPortOffset = ((portRank + 1) / (portCount + 1)) * targetNodeHeight - targetNodeHeight / 2;
                    return targetY + normalizedPortOffset;
                })
                .filter((value): value is number => value !== null);
            const score = contributions.length > 0
                ? contributions.reduce((sum, value) => sum + value, 0) / contributions.length
                : currentY;
            return {nodeId, score, currentY};
        });

        nodeScores.sort((left, right) => {
            if (left.score !== right.score) {
                return left.score - right.score;
            }
            if (left.currentY !== right.currentY) {
                return left.currentY - right.currentY;
            }
            return left.nodeId.localeCompare(right.nodeId);
        });

        nodeScores.forEach((item, index) => {
            const slotY = slotYs[index];
            if (typeof slotY !== 'number') {
                return;
            }
            const currentPosition = nextPositions[item.nodeId];
            if (!currentPosition) {
                return;
            }
            nextPositions[item.nodeId] = {
                x: currentPosition.x,
                y: slotY,
            };
        });
    }

    return nextPositions;
};

const buildNextNodeId = (existingIds: Set<string>): string => {
    let index = existingIds.size + 1;
    while (existingIds.has(`n${index}`)) {
        index += 1;
    }
    const id = `n${index}`;
    existingIds.add(id);
    return id;
};

export interface GraphClipboardSnapshot {
    nodes: NodeInstanceSpec[];
    edges: EdgeSpec[];
    relativePositions: Record<string, XYPosition>;
    origin: XYPosition;
}

export interface ApplyGraphClipboardOptions {
    offset?: XYPosition;
    pasteCount?: number;
}

export interface GraphPasteResult {
    nodes: NodeInstanceSpec[];
    edges: EdgeSpec[];
    positions: Record<string, XYPosition>;
    createdNodeIds: string[];
}

export const buildGraphClipboardSnapshot = (
    graph: GraphSpec,
    nodeIds: string[],
    positions: Record<string, XYPosition>,
): GraphClipboardSnapshot | null => {
    const dedupedNodeIds = [...new Set(nodeIds.map((nodeId) => nodeId.trim()).filter(Boolean))];
    if (dedupedNodeIds.length === 0) {
        return null;
    }
    const selectedNodeIdSet = new Set(dedupedNodeIds);
    const selectedNodes = graph.nodes
        .filter((node) => selectedNodeIdSet.has(node.node_id))
        .map((node) => cloneNode(node));
    if (selectedNodes.length === 0) {
        return null;
    }

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    for (const node of selectedNodes) {
        const pos = positions[node.node_id] ?? DEFAULT_POSITION;
        minX = Math.min(minX, pos.x);
        minY = Math.min(minY, pos.y);
    }
    const origin: XYPosition = {
        x: Number.isFinite(minX) ? minX : 0,
        y: Number.isFinite(minY) ? minY : 0,
    };

    const relativePositions: Record<string, XYPosition> = {};
    for (const node of selectedNodes) {
        const pos = positions[node.node_id] ?? DEFAULT_POSITION;
        relativePositions[node.node_id] = {
            x: pos.x - origin.x,
            y: pos.y - origin.y,
        };
    }

    const selectedEdges = graph.edges
        .filter((edge) => selectedNodeIdSet.has(edge.source_node) && selectedNodeIdSet.has(edge.target_node))
        .map((edge) => cloneEdge(edge));

    return {
        nodes: selectedNodes,
        edges: selectedEdges,
        relativePositions,
        origin,
    };
};

export const applyGraphClipboardSnapshot = (
    graph: GraphSpec,
    positions: Record<string, XYPosition>,
    snapshot: GraphClipboardSnapshot,
    options: ApplyGraphClipboardOptions = {},
): GraphPasteResult | null => {
    if (snapshot.nodes.length === 0) {
        return null;
    }
    const offset = options.offset ?? {x: 48, y: 48};
    const pasteCount = Math.max(1, options.pasteCount ?? 1);
    const shift: XYPosition = {
        x: offset.x * pasteCount,
        y: offset.y * pasteCount,
    };

    const existingIds = new Set(graph.nodes.map((node) => node.node_id));
    const idMapping = new Map<string, string>();
    for (const node of snapshot.nodes) {
        idMapping.set(node.node_id, buildNextNodeId(existingIds));
    }

    const clonedNodes = snapshot.nodes.map((node) => ({
        ...cloneNode(node),
        node_id: idMapping.get(node.node_id) ?? node.node_id,
    }));
    const clonedEdges = snapshot.edges.map((edge) => ({
        ...cloneEdge(edge),
        source_node: idMapping.get(edge.source_node) ?? edge.source_node,
        target_node: idMapping.get(edge.target_node) ?? edge.target_node,
    }));

    const nextPositions = {...positions};
    const createdNodeIds: string[] = [];
    for (const sourceNode of snapshot.nodes) {
        const nextNodeId = idMapping.get(sourceNode.node_id);
        if (!nextNodeId) {
            continue;
        }
        createdNodeIds.push(nextNodeId);
        const relative = snapshot.relativePositions[sourceNode.node_id] ?? DEFAULT_POSITION;
        nextPositions[nextNodeId] = {
            x: snapshot.origin.x + relative.x + shift.x,
            y: snapshot.origin.y + relative.y + shift.y,
        };
    }

    return {
        nodes: [...graph.nodes, ...clonedNodes],
        edges: [...graph.edges, ...clonedEdges],
        positions: nextPositions,
        createdNodeIds,
    };
};

export const buildSimpleAutoLayout = (
    graph: GraphSpec,
    startX = 80,
    startY = 80,
): Record<string, {x: number; y: number}> => {
    if (graph.nodes.length === 0) {
        return {};
    }
    const {groups} = buildLayerGroups(graph);

    const layerIds = [...groups.keys()].sort((a, b) => a - b);
    const xGap = 260;
    const yGap = 140;
    const positions: Record<string, {x: number; y: number}> = {};

    for (const layer of layerIds) {
        const layerNodes = groups.get(layer) ?? [];
        layerNodes.forEach((nodeId, index) => {
            positions[nodeId] = {
                x: startX + layer * xGap,
                y: startY + index * yGap,
            };
        });
    }

    return positions;
};

export const buildElkAutoLayout = async (
    graph: GraphSpec,
    options: ElkAutoLayoutOptions = {},
): Promise<Record<string, {x: number; y: number}>> => {
    const startX = options.startX ?? 80;
    const startY = options.startY ?? 80;
    const nodeWidth = options.nodeWidth ?? DEFAULT_LAYOUT_NODE_WIDTH;
    const nodeHeight = options.nodeHeight ?? DEFAULT_LAYOUT_NODE_HEIGHT;
    const layerSpacing = options.layerSpacing ?? DEFAULT_LAYER_SPACING;
    const nodeSpacing = options.nodeSpacing ?? DEFAULT_NODE_SPACING;
    const fallback = buildSimpleAutoLayout(graph, startX, startY);

    if (graph.nodes.length === 0) {
        return {};
    }

    const nodeIdSet = new Set(graph.nodes.map((node) => node.node_id));
    const nodePorts = collectNodePorts(graph);
    const nodeHeights: Record<string, number> = {};
    const elkNodes: ElkNode[] = graph.nodes.map((node) => {
        const customSize = options.nodeSizes?.[node.node_id];
        const resolvedWidth = isPositiveFiniteNumber(customSize?.width) ? customSize.width : nodeWidth;
        const resolvedHeight = isPositiveFiniteNumber(customSize?.height) ? customSize.height : nodeHeight;
        nodeHeights[node.node_id] = resolvedHeight;

        const ports = nodePorts.get(node.node_id);
        const inputPorts = [...(ports?.input ?? [])].sort(comparePortNames);
        const outputPorts = [...(ports?.output ?? [])].sort(comparePortNames);
        const elkPorts: ElkPort[] = [
            ...inputPorts.map((portName, index) => ({
                id: `${node.node_id}::in::${portName}`,
                layoutOptions: {
                    'org.eclipse.elk.port.side': 'WEST',
                    'org.eclipse.elk.port.index': String(index),
                },
            })),
            ...outputPorts.map((portName, index) => ({
                id: `${node.node_id}::out::${portName}`,
                layoutOptions: {
                    'org.eclipse.elk.port.side': 'EAST',
                    'org.eclipse.elk.port.index': String(index),
                },
            })),
        ];

        return {
            id: node.node_id,
            width: resolvedWidth,
            height: resolvedHeight,
            ports: elkPorts,
            layoutOptions: {
                'org.eclipse.elk.portConstraints': 'FIXED_ORDER',
            },
        };
    });

    const elkEdges: ElkExtendedEdge[] = graph.edges
        .filter((edge) => nodeIdSet.has(edge.source_node) && nodeIdSet.has(edge.target_node))
        .map((edge, index) => ({
            id: `edge_${index}_${edge.source_node}_${edge.target_node}`,
            sources: [`${edge.source_node}::out::${edge.source_port}`],
            targets: [`${edge.target_node}::in::${edge.target_port}`],
        }));

    const elkGraph: ElkNode = {
        id: 'root',
        children: elkNodes,
        edges: elkEdges,
        layoutOptions: {
            'org.eclipse.elk.algorithm': 'org.eclipse.elk.layered',
            'org.eclipse.elk.direction': 'RIGHT',
            'org.eclipse.elk.edgeRouting': 'SPLINES',
            'org.eclipse.elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
            'org.eclipse.elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
            'org.eclipse.elk.layered.spacing.nodeNodeBetweenLayers': String(layerSpacing),
            'org.eclipse.elk.spacing.nodeNode': String(nodeSpacing),
            'org.eclipse.elk.spacing.edgeNode': '20',
            'org.eclipse.elk.spacing.edgeEdge': '12',
        },
    };

    try {
        const elk = new ELK();
        const laidOut = await elk.layout(elkGraph);
        const positions = {...fallback};
        for (const node of laidOut.children ?? []) {
            if (!node.id || !(node.id in positions)) {
                continue;
            }
            if (
                typeof node.x !== 'number' ||
                !Number.isFinite(node.x) ||
                typeof node.y !== 'number' ||
                !Number.isFinite(node.y)
            ) {
                continue;
            }
            positions[node.id] = {
                x: startX + node.x,
                y: startY + node.y,
            };
        }
        return applyPortAwareLayerOrdering(graph, positions, nodeHeights, nodeHeight);
    } catch (error) {
        console.warn('[graph-editor] ELK auto layout failed, fallback to simple layout', error);
        return fallback;
    }
};

export const deriveValidationTargets = (
    graph: GraphSpec,
    issues: ValidationIssue[],
): ValidationTargets => {
    const nodeIds = new Set<string>();
    const edgeIds = new Set<string>();

    if (!issues.length) {
        return {nodeIds, edgeIds};
    }

    for (const issue of issues) {
        const message = issue.message;

        if (issue.code.startsWith('graph.')) {
            for (const node of graph.nodes) {
                nodeIds.add(node.node_id);
            }
            for (const edge of graph.edges) {
                edgeIds.add(buildEdgeId(edge.source_node, edge.source_port, edge.target_node, edge.target_port));
            }
            continue;
        }

        if (issue.code.startsWith('edge.')) {
            let matched = false;
            for (const edge of graph.edges) {
                const edgeId = buildEdgeId(edge.source_node, edge.source_port, edge.target_node, edge.target_port);
                if (
                    message.includes(edge.source_node) ||
                    message.includes(edge.target_node) ||
                    message.includes(`${edge.source_node}.${edge.source_port}`) ||
                    message.includes(`${edge.target_node}.${edge.target_port}`)
                ) {
                    matched = true;
                    edgeIds.add(edgeId);
                    nodeIds.add(edge.source_node);
                    nodeIds.add(edge.target_node);
                }
            }
            if (!matched) {
                for (const edge of graph.edges) {
                    edgeIds.add(buildEdgeId(edge.source_node, edge.source_port, edge.target_node, edge.target_port));
                }
            }
            continue;
        }

        if (issue.code.startsWith('node.') || issue.code.startsWith('sync.')) {
            let matched = false;
            for (const node of graph.nodes) {
                if (message.includes(node.node_id)) {
                    matched = true;
                    nodeIds.add(node.node_id);
                }
            }
            if (!matched) {
                for (const node of graph.nodes) {
                    nodeIds.add(node.node_id);
                }
            }
        }
    }

    return {nodeIds, edgeIds};
};

export const readNodePositionsFromMetadata = (
    metadata: Record<string, unknown>,
    allowedNodeIds?: Set<string>,
): Record<string, XYPosition> => {
    const layout = metadata[UI_LAYOUT_METADATA_KEY];
    if (!isRecord(layout)) {
        return {};
    }
    const rawPositions = layout[NODE_POSITIONS_METADATA_KEY];
    if (!isRecord(rawPositions)) {
        return {};
    }

    const positions: Record<string, XYPosition> = {};
    for (const [nodeId, rawPosition] of Object.entries(rawPositions)) {
        const normalizedNodeId = nodeId.trim();
        if (!normalizedNodeId) {
            continue;
        }
        if (allowedNodeIds && !allowedNodeIds.has(normalizedNodeId)) {
            continue;
        }
        if (!isRecord(rawPosition)) {
            continue;
        }
        const x = toFiniteNumber(rawPosition.x);
        const y = toFiniteNumber(rawPosition.y);
        if (x === null || y === null) {
            continue;
        }
        positions[normalizedNodeId] = {x, y};
    }
    return positions;
};

export const writeNodePositionsToMetadata = (
    metadata: Record<string, unknown>,
    positions: Record<string, XYPosition>,
    nodeIds?: string[],
): Record<string, unknown> => {
    const allowedNodeIds = nodeIds
        ? new Set(nodeIds.map((nodeId) => nodeId.trim()).filter(Boolean))
        : null;
    const sanitizedPositions: Record<string, XYPosition> = {};

    for (const [nodeId, position] of Object.entries(positions)) {
        const normalizedNodeId = nodeId.trim();
        if (!normalizedNodeId) {
            continue;
        }
        if (allowedNodeIds && !allowedNodeIds.has(normalizedNodeId)) {
            continue;
        }
        if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
            continue;
        }
        sanitizedPositions[normalizedNodeId] = {
            x: position.x,
            y: position.y,
        };
    }

    const nextMetadata: Record<string, unknown> = {...metadata};
    const rawLayout = metadata[UI_LAYOUT_METADATA_KEY];
    const nextLayout: Record<string, unknown> = isRecord(rawLayout) ? {...rawLayout} : {};

    if (Object.keys(sanitizedPositions).length === 0) {
        delete nextLayout[NODE_POSITIONS_METADATA_KEY];
        if (Object.keys(nextLayout).length === 0) {
            delete nextMetadata[UI_LAYOUT_METADATA_KEY];
        } else {
            nextMetadata[UI_LAYOUT_METADATA_KEY] = nextLayout;
        }
        return nextMetadata;
    }

    nextLayout[NODE_POSITIONS_METADATA_KEY] = sanitizedPositions;
    nextMetadata[UI_LAYOUT_METADATA_KEY] = nextLayout;
    return nextMetadata;
};
