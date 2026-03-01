import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {http, HttpResponse} from 'msw';
import {beforeEach, describe, expect, it} from 'vitest';

import {GraphEditor} from '../../src/features/graph-editor/GraphEditor';
import {resetGraphStore, useGraphStore} from '../../src/shared/state/graph-store';
import {resetUiStore, useUiStore} from '../../src/shared/state/ui-store';
import {server} from '../mocks/server';

describe('GraphEditor', () => {
    beforeEach(() => {
        resetGraphStore();
        resetUiStore();
    });

    it('adds nodes into graph store via drawer add buttons', async () => {
        render(<GraphEditor/>);

        await waitFor(() => {
            expect(screen.getByTestId('graph-editor-status').textContent).toContain('节点目录');
        });

        fireEvent.click(screen.getByTitle('新增节点'));
        let addButtons = screen.getAllByRole('button', {name: '添加到画布'});
        fireEvent.click(addButtons[0]!);

        fireEvent.click(screen.getByTitle('新增节点'));
        addButtons = screen.getAllByRole('button', {name: '添加到画布'});
        fireEvent.click(addButtons[1]!);

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

        await waitFor(() => {
            expect(screen.getByTestId('graph-editor-status').textContent).toContain('节点目录回退模式');
        });

        fireEvent.click(screen.getByTitle('新增节点'));
        const addButtons = screen.getAllByRole('button', {name: '添加到画布'});
        fireEvent.click(addButtons[0]!);
        expect(useGraphStore.getState().graph.nodes).toHaveLength(1);
    });

    it('deletes node through in-node delete button', async () => {
        render(<GraphEditor/>);

        await waitFor(() => {
            expect(screen.getByTestId('graph-editor-status').textContent).toContain('节点目录');
        });

        fireEvent.click(screen.getByTitle('新增节点'));
        let addButtons = screen.getAllByRole('button', {name: '添加到画布'});
        fireEvent.click(addButtons[0]!);
        fireEvent.click(screen.getByTitle('新增节点'));
        addButtons = screen.getAllByRole('button', {name: '添加到画布'});
        fireEvent.click(addButtons[1]!);
        expect(useGraphStore.getState().graph.nodes).toHaveLength(2);

        fireEvent.click(screen.getByTitle('删除 n1'));
        expect(useGraphStore.getState().graph.nodes).toHaveLength(1);
        expect(useGraphStore.getState().graph.nodes[0]?.node_id).toBe('n2');
    });

    it('applies auto-layout request and surfaces completion message (edge path)', async () => {
        render(<GraphEditor/>);
        await waitFor(() => {
            expect(screen.getByTestId('graph-editor-status').textContent).toContain('节点目录');
        });

        fireEvent.click(screen.getByTitle('新增节点'));
        const addButtons = screen.getAllByRole('button', {name: '添加到画布'});
        fireEvent.click(addButtons[0]!);
        fireEvent.click(addButtons[1]!);

        useUiStore.getState().requestAutoLayout();
        await waitFor(() => {
            expect(screen.getByTestId('graph-editor-status').textContent).toContain('节点目录');
            expect(screen.getByText('节点已自动整理')).toBeTruthy();
        });
    });

    it('renders updated canvas background, locator dots and minimap sizing', async () => {
        render(<GraphEditor/>);

        await waitFor(() => {
            expect(screen.getByTestId('graph-editor-status').textContent).toContain('节点目录');
        });

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

        await waitFor(() => {
            expect(screen.getByTestId('graph-editor-status').textContent).toContain('节点目录');
        });

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
