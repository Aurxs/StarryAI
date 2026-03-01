import type {Edge} from 'reactflow';

import type {EdgeSpec, GraphSpec, ValidationIssue} from '../../entities/workbench/types';

export const SOURCE_HANDLE_PREFIX = 'out:';
export const TARGET_HANDLE_PREFIX = 'in:';

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
    if (sourceSchema === 'any' || targetSchema === 'any') {
        return true;
    }
    return sourceSchema === targetSchema;
};

export const simplifyFrameSchema = (schema: string): string => {
    const normalized = schema.trim().toLowerCase();
    if (!normalized) {
        return 'unknown';
    }
    if (normalized === 'any') {
        return 'any';
    }
    const [head] = normalized.split('.');
    return head || normalized;
};

export const getSchemaColor = (schema: string): string => {
    const simple = simplifyFrameSchema(schema);
    switch (simple) {
        case 'text':
            return '#3b82f6';
        case 'audio':
            return '#16a34a';
        case 'motion':
            return '#f97316';
        case 'sync':
            return '#0891b2';
        case 'any':
            return '#64748b';
        default:
            return '#8b5cf6';
    }
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

export const buildSimpleAutoLayout = (
    graph: GraphSpec,
    startX = 80,
    startY = 80,
): Record<string, {x: number; y: number}> => {
    const nodeIds = graph.nodes.map((node) => node.node_id);
    if (nodeIds.length === 0) {
        return {};
    }

    const indegree = new Map<string, number>();
    const outgoing = new Map<string, string[]>();
    const incoming = new Map<string, string[]>();
    for (const nodeId of nodeIds) {
        indegree.set(nodeId, 0);
        outgoing.set(nodeId, []);
        incoming.set(nodeId, []);
    }

    for (const edge of graph.edges) {
        if (!indegree.has(edge.source_node) || !indegree.has(edge.target_node)) {
            continue;
        }
        indegree.set(edge.target_node, (indegree.get(edge.target_node) ?? 0) + 1);
        outgoing.get(edge.source_node)?.push(edge.target_node);
        incoming.get(edge.target_node)?.push(edge.source_node);
    }

    const queue: string[] = [];
    for (const [nodeId, degree] of indegree.entries()) {
        if (degree === 0) {
            queue.push(nodeId);
        }
    }

    const order: string[] = [];
    while (queue.length > 0) {
        const nodeId = queue.shift();
        if (!nodeId) {
            continue;
        }
        order.push(nodeId);
        for (const nextNode of outgoing.get(nodeId) ?? []) {
            const nextDegree = (indegree.get(nextNode) ?? 0) - 1;
            indegree.set(nextNode, nextDegree);
            if (nextDegree === 0) {
                queue.push(nextNode);
            }
        }
    }

    for (const nodeId of nodeIds) {
        if (!order.includes(nodeId)) {
            order.push(nodeId);
        }
    }

    const layers = new Map<string, number>();
    for (const nodeId of order) {
        const parentLayers = (incoming.get(nodeId) ?? [])
            .map((parentId) => layers.get(parentId) ?? 0);
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
