import {describe, expect, it} from 'vitest';

import type {GraphSpec} from '../../src/entities/workbench/types';
import {
    COMMIT_LEAD_KEY,
    READY_TIMEOUT_KEY,
    SYNC_GROUP_KEY,
    SYNC_MANAGED_BY_KEY,
    SYNC_ROUND_KEY,
    buildInitiatorDefaultConfig,
    buildSyncRelationFingerprint,
    reconcileSyncManagedConfig,
} from '../../src/features/sync-config/managed-config';

const buildBaseGraph = (): GraphSpec => ({
    graph_id: 'g_sync_managed',
    version: '0.1.0',
    nodes: [
        {
            node_id: 'n1',
            type_name: 'sync.initiator.dual',
            title: 'sync.initiator.dual',
            config: {
                sync_group: 'sg-main',
                sync_round: 0,
                ready_timeout_ms: 1200,
                commit_lead_ms: 90,
            },
        },
        {
            node_id: 'n2',
            type_name: 'audio.play.sync',
            title: 'audio.play.sync',
            config: {
                volume: 0.8,
            },
        },
        {
            node_id: 'n3',
            type_name: 'mock.output',
            title: 'mock.output',
            config: {},
        },
    ],
    edges: [
        {
            source_node: 'n1',
            source_port: 'out_a',
            target_node: 'n2',
            target_port: 'in',
            queue_maxsize: 0,
        },
    ],
    metadata: {},
});

describe('sync managed config reconcile', () => {
    it('reconciles managed fields from initiator to downstream sync executor', () => {
        const graph = buildBaseGraph();
        const result = reconcileSyncManagedConfig(graph);
        expect(result.changed).toBe(true);
        const executor = result.graph.nodes.find((node) => node.node_id === 'n2');
        expect(executor?.config).toMatchObject({
            volume: 0.8,
            sync_group: 'sg-main',
            sync_round: 0,
            ready_timeout_ms: 1200,
            commit_lead_ms: 90,
            __sync_managed_by: 'n1',
        });
    });

    it('resets managed sync fields when relation is removed and keeps runtime config', () => {
        const graph = buildBaseGraph();
        const first = reconcileSyncManagedConfig(graph).graph;
        const removedRelationGraph: GraphSpec = {
            ...first,
            edges: [],
        };

        const result = reconcileSyncManagedConfig(removedRelationGraph);
        expect(result.changed).toBe(true);
        const executor = result.graph.nodes.find((node) => node.node_id === 'n2');
        expect(executor?.config).toMatchObject({
            volume: 0.8,
            sync_group: '',
            sync_round: 0,
            ready_timeout_ms: 800,
            commit_lead_ms: 50,
        });
        expect(executor?.config[SYNC_MANAGED_BY_KEY]).toBeUndefined();
    });

    it('changes relation fingerprint only when sync relation/config changes (edge path)', () => {
        const graph = buildBaseGraph();
        const fp0 = buildSyncRelationFingerprint(graph);
        const fp1 = buildSyncRelationFingerprint({
            ...graph,
            nodes: graph.nodes.map((node) => (
                node.node_id === 'n3'
                    ? {...node, title: 'mock.output.v2'}
                    : node
            )),
        });
        expect(fp1).toBe(fp0);

        const fp2 = buildSyncRelationFingerprint({
            ...graph,
            nodes: graph.nodes.map((node) => (
                node.node_id === 'n1'
                    ? {
                        ...node,
                        config: {
                            ...node.config,
                            ready_timeout_ms: 1300,
                        },
                    }
                    : node
            )),
        });
        expect(fp2).not.toBe(fp0);
    });

    it('builds default initiator config with readable unique sync_group', () => {
        const config = buildInitiatorDefaultConfig([
            {
                node_id: 'n_old',
                type_name: 'sync.initiator.dual',
                title: 'old',
                config: {sync_group: 'sg-k001'},
            },
        ]);
        expect(String(config[SYNC_GROUP_KEY]).startsWith('sg-')).toBe(true);
        expect(config[SYNC_GROUP_KEY]).not.toBe('sg-k001');
        expect(config[SYNC_ROUND_KEY]).toBe(0);
        expect(config[READY_TIMEOUT_KEY]).toBe(800);
        expect(config[COMMIT_LEAD_KEY]).toBe(50);
    });
});
