import type {EdgeSpec, GraphSpec, NodeInstanceSpec} from '../../entities/workbench/types';

export const SYNC_MANAGED_BY_KEY = '__sync_managed_by';
export const SYNC_ROUND_AUTO_KEY = '__sync_round_auto';
export const SYNC_GROUP_KEY = 'sync_group';
export const SYNC_ROUND_KEY = 'sync_round';
export const READY_TIMEOUT_KEY = 'ready_timeout_ms';
export const COMMIT_LEAD_KEY = 'commit_lead_ms';

export const DEFAULT_SYNC_GROUP = '';
export const DEFAULT_SYNC_ROUND = 0;
export const DEFAULT_READY_TIMEOUT_MS = 800;
export const DEFAULT_COMMIT_LEAD_MS = 50;

export const SYNC_MANAGED_CONFIG_KEYS = [
    SYNC_GROUP_KEY,
    SYNC_ROUND_KEY,
    READY_TIMEOUT_KEY,
    COMMIT_LEAD_KEY,
] as const;

const normalizeSyncGroup = (rawValue: unknown, fallbackValue = DEFAULT_SYNC_GROUP): string => {
    if (typeof rawValue !== 'string') {
        return fallbackValue;
    }
    const value = rawValue.trim();
    return value || fallbackValue;
};

const normalizeInt = (rawValue: unknown, fallbackValue: number, minValue: number): number => {
    if (typeof rawValue !== 'number' || !Number.isInteger(rawValue)) {
        return fallbackValue;
    }
    return rawValue >= minValue ? rawValue : fallbackValue;
};

export const isSyncInitiatorNodeType = (typeName: string): boolean =>
    typeName === 'sync.initiator.dual' || typeName.startsWith('sync.initiator.');

export const isSyncExecutorNodeType = (typeName: string): boolean =>
    typeName.endsWith('.sync') && !isSyncInitiatorNodeType(typeName);

export interface ManagedSyncConfigValues {
    sync_group: string;
    sync_round: number;
    ready_timeout_ms: number;
    commit_lead_ms: number;
}

export const readManagedSyncConfig = (config: Record<string, unknown>): ManagedSyncConfigValues => ({
    sync_group: normalizeSyncGroup(config[SYNC_GROUP_KEY], DEFAULT_SYNC_GROUP),
    sync_round: normalizeInt(config[SYNC_ROUND_KEY], DEFAULT_SYNC_ROUND, 0),
    ready_timeout_ms: normalizeInt(config[READY_TIMEOUT_KEY], DEFAULT_READY_TIMEOUT_MS, 1),
    commit_lead_ms: normalizeInt(config[COMMIT_LEAD_KEY], DEFAULT_COMMIT_LEAD_MS, 1),
});

const hasExecutorManagedPayload = (config: Record<string, unknown>): boolean =>
    typeof config[SYNC_MANAGED_BY_KEY] === 'string'
    || SYNC_MANAGED_CONFIG_KEYS.some((key) => key in config);

const buildSyncRelationEdges = (graph: GraphSpec): EdgeSpec[] => {
    const nodeById = new Map(graph.nodes.map((node) => [node.node_id, node]));
    return graph.edges.filter((edge) => {
        const sourceNode = nodeById.get(edge.source_node);
        const targetNode = nodeById.get(edge.target_node);
        if (!sourceNode || !targetNode) {
            return false;
        }
        return isSyncInitiatorNodeType(sourceNode.type_name) && isSyncExecutorNodeType(targetNode.type_name);
    });
};

const buildEdgeKey = (edge: EdgeSpec): string =>
    `${edge.source_node}.${edge.source_port}->${edge.target_node}.${edge.target_port}`;

export const buildSyncRelationFingerprint = (graph: GraphSpec): string => {
    const initiatorNodes = graph.nodes
        .filter((node) => isSyncInitiatorNodeType(node.type_name))
        .map((node) => ({
            node_id: node.node_id,
            ...readManagedSyncConfig(node.config),
        }))
        .sort((left, right) => left.node_id.localeCompare(right.node_id));
    const relationEdges = buildSyncRelationEdges(graph)
        .map((edge) => buildEdgeKey(edge))
        .sort((left, right) => left.localeCompare(right));
    return JSON.stringify({
        initiators: initiatorNodes,
        relations: relationEdges,
    });
};

const hasSameManagedConfig = (
    config: Record<string, unknown>,
    values: ManagedSyncConfigValues,
    managerNodeId: string,
): boolean =>
    normalizeSyncGroup(config[SYNC_GROUP_KEY], DEFAULT_SYNC_GROUP) === values.sync_group
    && normalizeInt(config[SYNC_ROUND_KEY], DEFAULT_SYNC_ROUND, 0) === values.sync_round
    && normalizeInt(config[READY_TIMEOUT_KEY], DEFAULT_READY_TIMEOUT_MS, 1) === values.ready_timeout_ms
    && normalizeInt(config[COMMIT_LEAD_KEY], DEFAULT_COMMIT_LEAD_MS, 1) === values.commit_lead_ms
    && config[SYNC_MANAGED_BY_KEY] === managerNodeId;

const hasDefaultManagedConfig = (config: Record<string, unknown>): boolean =>
    normalizeSyncGroup(config[SYNC_GROUP_KEY], DEFAULT_SYNC_GROUP) === DEFAULT_SYNC_GROUP
    && normalizeInt(config[SYNC_ROUND_KEY], DEFAULT_SYNC_ROUND, 0) === DEFAULT_SYNC_ROUND
    && normalizeInt(config[READY_TIMEOUT_KEY], DEFAULT_READY_TIMEOUT_MS, 1) === DEFAULT_READY_TIMEOUT_MS
    && normalizeInt(config[COMMIT_LEAD_KEY], DEFAULT_COMMIT_LEAD_MS, 1) === DEFAULT_COMMIT_LEAD_MS
    && typeof config[SYNC_MANAGED_BY_KEY] !== 'string';

export interface SyncManagedReconcileResult {
    graph: GraphSpec;
    changed: boolean;
    fingerprint: string;
}

export const reconcileSyncManagedConfig = (graph: GraphSpec): SyncManagedReconcileResult => {
    const fingerprint = buildSyncRelationFingerprint(graph);
    const nodeById = new Map(graph.nodes.map((node) => [node.node_id, node]));
    const relationEdges = buildSyncRelationEdges(graph)
        .slice()
        .sort((left, right) => buildEdgeKey(left).localeCompare(buildEdgeKey(right)));
    const managerByExecutor = new Map<string, string>();
    for (const edge of relationEdges) {
        if (!managerByExecutor.has(edge.target_node)) {
            managerByExecutor.set(edge.target_node, edge.source_node);
        }
    }

    let changed = false;
    const nextNodes = graph.nodes.map((node) => {
        if (!isSyncExecutorNodeType(node.type_name)) {
            return node;
        }
        const managerNodeId = managerByExecutor.get(node.node_id);
        const currentConfig = {...node.config};
        if (managerNodeId) {
            const managerNode = nodeById.get(managerNodeId);
            const managedValues = readManagedSyncConfig(managerNode?.config ?? {});
            if (hasSameManagedConfig(currentConfig, managedValues, managerNodeId)) {
                return node;
            }
            changed = true;
            return {
                ...node,
                config: {
                    ...currentConfig,
                    ...managedValues,
                    [SYNC_MANAGED_BY_KEY]: managerNodeId,
                },
            };
        }
        if (!hasExecutorManagedPayload(currentConfig) || hasDefaultManagedConfig(currentConfig)) {
            return node;
        }
        const resetConfig: Record<string, unknown> = {
            ...currentConfig,
            [SYNC_GROUP_KEY]: DEFAULT_SYNC_GROUP,
            [SYNC_ROUND_KEY]: DEFAULT_SYNC_ROUND,
            [READY_TIMEOUT_KEY]: DEFAULT_READY_TIMEOUT_MS,
            [COMMIT_LEAD_KEY]: DEFAULT_COMMIT_LEAD_MS,
        };
        delete resetConfig[SYNC_MANAGED_BY_KEY];
        changed = true;
        return {
            ...node,
            config: resetConfig,
        };
    });

    if (!changed) {
        return {graph, changed: false, fingerprint};
    }
    return {
        graph: {
            ...graph,
            nodes: nextNodes,
        },
        changed: true,
        fingerprint,
    };
};

export const buildSyncGroupId = (nodes: NodeInstanceSpec[]): string => {
    const existingGroups = new Set(
        nodes
            .map((node) => normalizeSyncGroup(node.config[SYNC_GROUP_KEY], ''))
            .filter(Boolean),
    );
    for (let attempt = 0; attempt < 64; attempt += 1) {
        const token = Math.random().toString(36).slice(2, 6);
        const candidate = `sg-${token}`;
        if (!existingGroups.has(candidate)) {
            return candidate;
        }
    }
    let suffix = 1;
    let fallback = `sg-${suffix}`;
    while (existingGroups.has(fallback)) {
        suffix += 1;
        fallback = `sg-${suffix}`;
    }
    return fallback;
};

export const buildInitiatorDefaultConfig = (nodes: NodeInstanceSpec[]): Record<string, unknown> => ({
    [SYNC_GROUP_KEY]: buildSyncGroupId(nodes),
    [SYNC_ROUND_KEY]: DEFAULT_SYNC_ROUND,
    [READY_TIMEOUT_KEY]: DEFAULT_READY_TIMEOUT_MS,
    [COMMIT_LEAD_KEY]: DEFAULT_COMMIT_LEAD_MS,
    [SYNC_ROUND_AUTO_KEY]: true,
});

export const stripManagedSyncFields = (config: Record<string, unknown>): Record<string, unknown> => {
    const nextConfig: Record<string, unknown> = {...config};
    for (const key of SYNC_MANAGED_CONFIG_KEYS) {
        delete nextConfig[key];
    }
    delete nextConfig[SYNC_MANAGED_BY_KEY];
    delete nextConfig[SYNC_ROUND_AUTO_KEY];
    return nextConfig;
};

export const getManagedByNodeId = (config: Record<string, unknown>): string | null => {
    const rawValue = config[SYNC_MANAGED_BY_KEY];
    if (typeof rawValue !== 'string') {
        return null;
    }
    const value = rawValue.trim();
    return value || null;
};
