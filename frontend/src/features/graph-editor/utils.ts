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
