import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {http, HttpResponse} from 'msw';
import {beforeEach, describe, expect, it} from 'vitest';

import {GraphEditor} from '../../src/features/graph-editor/GraphEditor';
import {resetGraphStore, useGraphStore} from '../../src/shared/state/graph-store';
import {server} from '../mocks/server';

describe('GraphEditor', () => {
    beforeEach(() => {
        resetGraphStore();
    });

    it('adds nodes into graph store via palette Add buttons', async () => {
        render(<GraphEditor/>);

        await waitFor(() => {
            expect(screen.getByTestId('graph-editor-status').textContent).toContain('Catalog');
        });

        const addButtons = screen.getAllByRole('button', {name: 'Add'});
        fireEvent.click(addButtons[0]!);
        fireEvent.click(addButtons[1]!);

        const graph = useGraphStore.getState().graph;
        expect(graph.nodes).toHaveLength(2);
        expect(screen.getByTestId('graph-editor-meta').textContent).toContain('nodes=2');
    });

    it('falls back to built-in catalog when node-types API fails (edge path)', async () => {
        server.use(
            http.get('*/api/v1/node-types', () =>
                HttpResponse.json(
                    {detail: 'temporary error'},
                    {
                        status: 503,
                    },
                ),
            ),
        );

        render(<GraphEditor/>);

        await waitFor(() => {
            expect(screen.getByTestId('graph-editor-status').textContent).toContain('Catalog fallback active');
        });

        const addButtons = screen.getAllByRole('button', {name: 'Add'});
        fireEvent.click(addButtons[0]!);
        expect(useGraphStore.getState().graph.nodes).toHaveLength(1);
    });

    it('deletes node through in-node delete button', async () => {
        render(<GraphEditor/>);

        await waitFor(() => {
            expect(screen.getByTestId('graph-editor-status').textContent).toContain('Catalog');
        });

        const addButtons = screen.getAllByRole('button', {name: 'Add'});
        fireEvent.click(addButtons[0]!);
        fireEvent.click(addButtons[1]!);
        expect(useGraphStore.getState().graph.nodes).toHaveLength(2);

        fireEvent.click(screen.getByTitle('Delete n1'));
        expect(useGraphStore.getState().graph.nodes).toHaveLength(1);
        expect(useGraphStore.getState().graph.nodes[0]?.node_id).toBe('n2');
    });
});
