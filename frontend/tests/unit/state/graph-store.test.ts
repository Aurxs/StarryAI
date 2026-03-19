import {beforeEach, describe, expect, it} from 'vitest';

import type {EdgeSpec, NodeInstanceSpec} from '../../../src/entities/workbench/types';
import {resetGraphStore, useGraphStore} from '../../../src/shared/state/graph-store';

describe('graph store', () => {
    beforeEach(() => {
        resetGraphStore();
    });

    it('starts with a clean default graph', () => {
        const state = useGraphStore.getState();
        expect(state.graph.graph_id).toBe('graph_new');
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
        expect(state.graph.graph_id).toBe('graph_new');
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

    it('updates graph metadata without appending undo history (edge path)', () => {
        useGraphStore.getState().setMetadata({
            ui_layout: {
                node_positions: {
                    n1: {x: 120, y: 240},
                },
            },
        });

        const state = useGraphStore.getState();
        expect(state.graph.metadata).toEqual({
            ui_layout: {
                node_positions: {
                    n1: {x: 120, y: 240},
                },
            },
        });
        expect(state.isDirty).toBe(true);
        expect(state.canUndo).toBe(false);
        expect(state.historyEntries).toHaveLength(0);
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

    it('replaces graph snapshot and resets dirty/history/validation state', () => {
        useGraphStore.getState().upsertNode({
            node_id: 'n1',
            type_name: 'mock.input',
            title: 'n1',
            config: {},
        });
        useGraphStore.getState().setValidationResult(false, [
            {
                level: 'error',
                code: 'graph.error',
                message: 'error',
            },
        ]);

        useGraphStore.getState().replaceGraph({
            graph_id: 'graph_loaded',
            version: '1.0.0',
            nodes: [
                {
                    node_id: 'n2',
                    type_name: 'mock.output',
                    title: 'n2',
                    config: {},
                },
            ],
            edges: [],
            metadata: {},
        });

        const state = useGraphStore.getState();
        expect(state.graph.graph_id).toBe('graph_loaded');
        expect(state.graph.nodes.map((node) => node.node_id)).toEqual(['n2']);
        expect(state.isDirty).toBe(false);
        expect(state.canUndo).toBe(false);
        expect(state.canRedo).toBe(false);
        expect(state.historyEntries).toHaveLength(0);
        expect(state.validationValid).toBeNull();
        expect(state.validationIssues).toHaveLength(0);
    });

    it('creates variables and records them in undo history', () => {
        const created = useGraphStore.getState().createVariable({
            name: 'counter',
            value_kind: 'scalar.int',
            initial_value: 1,
        });

        expect(created).toBe(true);
        expect(useGraphStore.getState().graph.metadata.data_registry?.variables).toEqual([
            {
                name: 'counter',
                value_kind: 'scalar.int',
                initial_value: 1,
            },
        ]);
        expect(useGraphStore.getState().canUndo).toBe(true);

        useGraphStore.getState().undo();
        expect(useGraphStore.getState().graph.metadata.data_registry?.variables).toEqual([]);
    });

    it('creates constants and records constant history labels', () => {
        const created = useGraphStore.getState().createVariable({
            name: 'api_key',
            value_kind: 'scalar.string',
            initial_value: 'token-1',
            is_constant: true,
        });

        expect(created).toBe(true);
        expect(useGraphStore.getState().graph.metadata.data_registry?.variables).toEqual([
            {
                name: 'api_key',
                value_kind: 'scalar.string',
                initial_value: 'token-1',
                is_constant: true,
            },
        ]);
        expect(useGraphStore.getState().historyEntries.at(-1)?.label).toBe('constantCreated');
    });

    it('renames variables and synchronizes data node references', () => {
        useGraphStore.getState().createVariable({
            name: 'counter',
            value_kind: 'scalar.int',
            initial_value: 0,
        });
        useGraphStore.getState().setNodes([
            {
                node_id: 'v1',
                type_name: 'data.ref',
                title: 'Variable Ref',
                config: {
                    variable_name: 'counter',
                },
            },
            {
                node_id: 'w1',
                type_name: 'data.writer',
                title: 'Writer',
                config: {
                    target_variable_name: 'counter',
                    operand_mode: 'variable',
                    operand_variable_name: 'counter',
                },
            },
        ]);

        const renamed = useGraphStore.getState().renameVariable('counter', 'balance');
        expect(renamed).toBe(true);

        const state = useGraphStore.getState();
        expect(state.graph.metadata.data_registry?.variables[0]?.name).toBe('balance');
        expect(state.graph.nodes[0]?.config.variable_name).toBe('balance');
        expect(state.graph.nodes[1]?.config.target_variable_name).toBe('balance');
        expect(state.graph.nodes[1]?.config.operand_variable_name).toBe('balance');
    });

    it('deletes variables without clearing stale node references', () => {
        useGraphStore.getState().createVariable({
            name: 'counter',
            value_kind: 'scalar.int',
            initial_value: 0,
        });
        useGraphStore.getState().upsertNode({
            node_id: 'v1',
            type_name: 'data.ref',
            title: 'Variable Ref',
            config: {
                variable_name: 'counter',
            },
        });

        const deleted = useGraphStore.getState().deleteVariable('counter');
        expect(deleted).toBe(true);

        const state = useGraphStore.getState();
        expect(state.graph.metadata.data_registry?.variables).toEqual([]);
        expect(state.graph.nodes[0]?.config.variable_name).toBe('counter');
    });

    it('updates variables and clears stale validation results', () => {
        useGraphStore.getState().createVariable({
            name: 'counter',
            value_kind: 'scalar.int',
            initial_value: 0,
        });
        useGraphStore.getState().setValidationResult(true, []);

        const updated = useGraphStore.getState().updateVariable('counter', {
            value_kind: 'scalar.float',
            initial_value: 1.5,
        });

        expect(updated).toBe(true);
        const state = useGraphStore.getState();
        expect(state.graph.metadata.data_registry?.variables[0]).toEqual({
            name: 'counter',
            value_kind: 'scalar.float',
            initial_value: 1.5,
        });
        expect(state.validationValid).toBeNull();
        expect(state.validationIssues).toHaveLength(0);
    });

    it('refuses to rename update or delete constants', () => {
        useGraphStore.getState().createVariable({
            name: 'api_key',
            value_kind: 'scalar.string',
            initial_value: 'token-1',
            is_constant: true,
        });

        const renamed = useGraphStore.getState().renameVariable('api_key', 'api_key_next');
        const updated = useGraphStore.getState().updateVariable('api_key', {
            value_kind: 'scalar.string',
            initial_value: 'token-2',
        });
        const deleted = useGraphStore.getState().deleteVariable('api_key');

        expect(renamed).toBe(false);
        expect(updated).toBe(false);
        expect(deleted).toBe(false);
        expect(useGraphStore.getState().graph.metadata.data_registry?.variables).toEqual([
            {
                name: 'api_key',
                value_kind: 'scalar.string',
                initial_value: 'token-1',
                is_constant: true,
            },
        ]);
    });
});
