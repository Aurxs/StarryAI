import {fireEvent, render, screen} from '@testing-library/react';
import {beforeEach, describe, expect, it} from 'vitest';

import {NodeConfigPanel} from '../../src/features/node-config/NodeConfigPanel';
import {resetGraphStore, useGraphStore} from '../../src/shared/state/graph-store';

describe('NodeConfigPanel', () => {
    beforeEach(() => {
        resetGraphStore();
    });

    it('shows empty-state prompt when no node is selected', () => {
        render(<NodeConfigPanel/>);

        expect(screen.getByTestId('node-config-empty').textContent).toContain(
            'Select a node on canvas to edit',
        );
    });

    it('updates selected node title and config on save', () => {
        useGraphStore.getState().upsertNode({
            node_id: 'n1',
            type_name: 'mock.input',
            title: 'Input Node',
            config: {
                content: 'hello',
            },
        });
        useGraphStore.getState().selectNode('n1');

        render(<NodeConfigPanel/>);

        fireEvent.change(screen.getByTestId('node-config-title-input'), {
            target: {value: 'Input Node Updated'},
        });
        fireEvent.change(screen.getByTestId('node-config-json-input'), {
            target: {value: '{\n  "content": "world"\n}'},
        });
        fireEvent.click(screen.getByRole('button', {name: 'Save'}));

        const state = useGraphStore.getState();
        const node = state.graph.nodes.find((item) => item.node_id === 'n1');
        expect(node?.title).toBe('Input Node Updated');
        expect(node?.config).toEqual({content: 'world'});
        expect(screen.queryByTestId('node-config-error')).toBeNull();
    });

    it('shows error for invalid json and keeps original config (edge path)', () => {
        useGraphStore.getState().upsertNode({
            node_id: 'n2',
            type_name: 'mock.output',
            title: 'Output Node',
            config: {
                enabled: true,
            },
        });
        useGraphStore.getState().selectNode('n2');

        render(<NodeConfigPanel/>);

        fireEvent.change(screen.getByTestId('node-config-json-input'), {
            target: {value: '{invalid'},
        });
        fireEvent.click(screen.getByRole('button', {name: 'Save'}));

        expect(screen.getByTestId('node-config-error').textContent).toContain('Config JSON is invalid');
        const node = useGraphStore
            .getState()
            .graph.nodes.find((item) => item.node_id === 'n2');
        expect(node?.config).toEqual({enabled: true});
    });
});
