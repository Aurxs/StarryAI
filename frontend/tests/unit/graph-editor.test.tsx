import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {http, HttpResponse} from 'msw';
import {beforeEach, describe, expect, it} from 'vitest';

import {GraphEditor} from '../../src/features/graph-editor/GraphEditor';
import {resetGraphStore, useGraphStore} from '../../src/shared/state/graph-store';
import {resetUiStore, useUiStore} from '../../src/shared/state/ui-store';
import {server} from '../mocks/server';

const addNodeFromDrawer = (typeName: string) => {
    fireEvent.click(screen.getByTitle('新增节点'));
    const drawer = screen.getByLabelText('node-library-drawer');
    fireEvent.click(within(drawer).getByText(typeName));
};

describe('GraphEditor', () => {
    beforeEach(() => {
        resetGraphStore();
        resetUiStore();
    });

    it('adds nodes into graph store via drawer add buttons', async () => {
        render(<GraphEditor/>);

        addNodeFromDrawer('mock.input');
        addNodeFromDrawer('mock.output');

        const graph = useGraphStore.getState().graph;
        expect(graph.nodes).toHaveLength(2);
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

        addNodeFromDrawer('mock.input');
        expect(useGraphStore.getState().graph.nodes).toHaveLength(1);
    });

    it('deletes node through in-node delete button', async () => {
        render(<GraphEditor/>);

        addNodeFromDrawer('mock.input');
        addNodeFromDrawer('mock.output');
        expect(useGraphStore.getState().graph.nodes).toHaveLength(2);

        fireEvent.click(screen.getByTitle('删除 n1'));
        expect(useGraphStore.getState().graph.nodes).toHaveLength(1);
        expect(useGraphStore.getState().graph.nodes[0]?.node_id).toBe('n2');
    });

    it('opens node config target by single-click in pointer and hand modes', async () => {
        render(<GraphEditor/>);

        addNodeFromDrawer('mock.input');

        const nodeCard = await screen.findByTestId('workflow-node-n1');

        useUiStore.getState().setEditorMode('pointer');
        useGraphStore.getState().selectNode(null);
        fireEvent.click(nodeCard);
        expect(useGraphStore.getState().selectedNodeId).toBe('n1');

        useUiStore.getState().setEditorMode('hand');
        useGraphStore.getState().selectNode(null);
        fireEvent.click(nodeCard);
        expect(useGraphStore.getState().selectedNodeId).toBe('n1');
    });

    it('applies auto-layout request and surfaces completion message (edge path)', async () => {
        render(<GraphEditor/>);

        addNodeFromDrawer('mock.input');
        addNodeFromDrawer('mock.output');

        useUiStore.getState().requestAutoLayout();
        await screen.findByText('节点已自动整理');
    });

    it('renders updated canvas background, locator dots and minimap sizing', async () => {
        render(<GraphEditor/>);

        expect((screen.getByTestId('graph-editor-shell') as HTMLElement).style.background).toBe('rgb(242, 244, 247)');

        const background = screen.getByTestId('rf__background');
        const locatorDot = background.querySelector('circle');
        expect(locatorDot?.getAttribute('fill')).toBe('#c3ccd8');
        expect(locatorDot?.getAttribute('r')).toBe('0.9');

        const minimap = screen.getByTestId('rf__minimap') as HTMLElement;
        expect(minimap.style.width).toBe('132px');
        expect(minimap.style.height).toBe('84px');
        expect(screen.getByTestId('zoom-control-bar')).toBeTruthy();
    });

    it('supports +/-10% zoom controls and clamps ratio to [20%, 200%] (edge path)', async () => {
        render(<GraphEditor/>);

        const zoomRatioButton = screen.getByTestId('zoom-ratio-button');
        const zoomOutButton = screen.getByTitle('缩小 10%');
        const zoomInButton = screen.getByTitle('放大 10%');

        expect(zoomRatioButton.textContent).toContain('70%');
        fireEvent.click(zoomInButton);
        await waitFor(() => {
            expect(screen.getByTestId('zoom-ratio-button').textContent).toContain('80%');
        });

        for (let i = 0; i < 12; i += 1) {
            fireEvent.click(zoomOutButton);
        }
        await waitFor(() => {
            expect(screen.getByTestId('zoom-ratio-button').textContent).toContain('20%');
        });

        for (let i = 0; i < 30; i += 1) {
            fireEvent.click(zoomInButton);
        }
        await waitFor(() => {
            expect(screen.getByTestId('zoom-ratio-button').textContent).toContain('200%');
        });
    });
});
