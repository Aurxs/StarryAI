import {beforeEach, describe, expect, it} from 'vitest';

import type {EdgeSpec, NodeInstanceSpec} from '../../../src/entities/workbench/types';
import {resetGraphStore, useGraphStore} from '../../../src/shared/state/graph-store';

describe('graph store', () => {
    beforeEach(() => {
        resetGraphStore();
    });

    it('starts with a clean default graph', () => {
        const state = useGraphStore.getState();
        expect(state.graph.graph_id).toBe('graph_phase_e');
        expect(state.graph.nodes).toHaveLength(0);
        expect(state.graph.edges).toHaveLength(0);
        expect(state.selectedNodeId).toBeNull();
        expect(state.isDirty).toBe(false);
    });

    it('upserts nodes and removes linked edges when deleting a node', () => {
        const nodeA: NodeInstanceSpec = {
            node_id: 'n1',
            type_name: 'mock.input',
            title: 'Input',
            config: {},
        };
        const nodeB: NodeInstanceSpec = {
            node_id: 'n2',
            type_name: 'mock.output',
            title: 'Output',
            config: {},
        };
        const edge: EdgeSpec = {
            source_node: 'n1',
            source_port: 'text',
            target_node: 'n2',
            target_port: 'in',
            queue_maxsize: 0,
        };

        useGraphStore.getState().upsertNode(nodeA);
        useGraphStore.getState().upsertNode(nodeB);
        useGraphStore.getState().setEdges([edge]);
        useGraphStore.getState().selectNode('n1');
        useGraphStore.getState().removeNode('n1');

        const state = useGraphStore.getState();
        expect(state.graph.nodes.map((item) => item.node_id)).toEqual(['n2']);
        expect(state.graph.edges).toHaveLength(0);
        expect(state.selectedNodeId).toBeNull();
        expect(state.isDirty).toBe(true);
    });

    it('keeps clean state when removing a non-existent node (edge path)', () => {
        useGraphStore.getState().removeNode('ghost_node');
        const state = useGraphStore.getState();

        expect(state.graph.nodes).toHaveLength(0);
        expect(state.graph.edges).toHaveLength(0);
        expect(state.isDirty).toBe(false);
    });

    it('ignores blank graph id when setting meta (edge path)', () => {
        useGraphStore.getState().setGraphMeta('   ', '2.0.0');
        const state = useGraphStore.getState();
        expect(state.graph.graph_id).toBe('graph_phase_e');
        expect(state.graph.version).toBe('2.0.0');
    });

    it('patches node title/config and ignores unknown node ids (edge path)', () => {
        useGraphStore.getState().upsertNode({
            node_id: 'n3',
            type_name: 'mock.llm',
            title: 'LLM',
            config: {
                temperature: 0.2,
            },
        });
        useGraphStore.getState().patchNode('n3', {
            title: 'LLM Updated',
            config: {
                temperature: 0.6,
            },
        });
        useGraphStore.getState().patchNode('missing_node', {
            title: 'ignored',
        });

        const state = useGraphStore.getState();
        const patched = state.graph.nodes.find((node) => node.node_id === 'n3');
        expect(patched?.title).toBe('LLM Updated');
        expect(patched?.config).toEqual({temperature: 0.6});
    });

    it('records validation result and clears it on graph changes', () => {
        useGraphStore.getState().setValidationResult(true, []);
        expect(useGraphStore.getState().validationValid).toBe(true);
        expect(useGraphStore.getState().validationCheckedAt).not.toBeNull();

        useGraphStore.getState().setNodes([
            {
                node_id: 'n9',
                type_name: 'mock.input',
                title: 'n9',
                config: {},
            },
        ]);

        const state = useGraphStore.getState();
        expect(state.validationValid).toBeNull();
        expect(state.validationIssues).toHaveLength(0);
        expect(state.validationCheckedAt).toBeNull();
    });

    it('supports undo/redo and records operation history (edge path)', () => {
        useGraphStore.getState().upsertNode({
            node_id: 'n1',
            type_name: 'mock.input',
            title: 'n1',
            config: {},
        });
        useGraphStore.getState().upsertNode({
            node_id: 'n2',
            type_name: 'mock.output',
            title: 'n2',
            config: {},
        });

        expect(useGraphStore.getState().canUndo).toBe(true);
        expect(useGraphStore.getState().graph.nodes).toHaveLength(2);

        useGraphStore.getState().undo();
        expect(useGraphStore.getState().graph.nodes).toHaveLength(1);
        expect(useGraphStore.getState().canRedo).toBe(true);

        useGraphStore.getState().redo();
        expect(useGraphStore.getState().graph.nodes).toHaveLength(2);
        expect(useGraphStore.getState().historyEntries.length).toBeGreaterThan(0);
    });
});
