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

    it('deletes node through node context menu', async () => {
        render(<GraphEditor/>);

        addNodeFromDrawer('mock.input');
        addNodeFromDrawer('mock.output');
        expect(useGraphStore.getState().graph.nodes).toHaveLength(2);

        const nodeCard = await screen.findByTestId('workflow-node-n1');
        fireEvent.contextMenu(nodeCard);
        expect(useGraphStore.getState().selectedNodeId).toBeNull();
        fireEvent.click(screen.getByRole('button', {name: '删除 Del'}));
        expect(useGraphStore.getState().graph.nodes).toHaveLength(1);
        expect(useGraphStore.getState().graph.nodes[0]?.node_id).toBe('n2');
    });

    it('renders context menu with about section and shortcuts', async () => {
        render(<GraphEditor/>);

        addNodeFromDrawer('mock.input');

        const nodeCard = await screen.findByTestId('workflow-node-n1');
        fireEvent.contextMenu(nodeCard);

        const menu = screen.getByRole('menu', {name: 'node-context-menu'});
        expect(within(menu).getByText('拷贝')).toBeTruthy();
        expect(within(menu).getByText('复制')).toBeTruthy();
        expect(within(menu).getByText('删除')).toBeTruthy();
        expect(within(menu).getByText(/(⌘|Ctrl)\sC/)).toBeTruthy();
        expect(within(menu).getByText(/(⌘|Ctrl)\sD/)).toBeTruthy();
        expect(within(menu).getByText('Del')).toBeTruthy();
        expect(within(menu).getByText('关于')).toBeTruthy();
        expect(within(menu).getByText('mock.input')).toBeTruthy();
        expect(within(menu).getByText('暂无节点说明。')).toBeTruthy();
    });

    it('supports single-node copy/paste shortcuts with full config cloning', async () => {
        render(<GraphEditor/>);

        addNodeFromDrawer('mock.input');
        useGraphStore.getState().patchNode('n1', {
            title: 'Input A',
            config: {
                nested: {temperature: 0.42},
                retry: 2,
            },
        });

        const nodeCard = await screen.findByTestId('workflow-node-n1');
        fireEvent.click(nodeCard);
        fireEvent.keyDown(window, {key: 'c', metaKey: true});
        fireEvent.keyDown(window, {key: 'v', metaKey: true});

        await waitFor(() => {
            expect(useGraphStore.getState().graph.nodes).toHaveLength(2);
        });

        const [original, copied] = useGraphStore.getState().graph.nodes;
        expect(original?.node_id).toBe('n1');
        expect(copied?.node_id).toBe('n2');
        expect(copied?.type_name).toBe(original?.type_name);
        expect(copied?.title).toBe(original?.title);
        expect(copied?.config).toEqual(original?.config);
        expect(copied?.config).not.toBe(original?.config);
    });

    it('opens node config target by single-click in pointer and hand modes', async () => {
        render(<GraphEditor/>);

        addNodeFromDrawer('mock.input');

        const nodeCard = await screen.findByTestId('workflow-node-n1');

        useUiStore.getState().setEditorMode('pointer');
        useGraphStore.getState().selectNode(null);
        fireEvent.click(nodeCard);
        expect(useGraphStore.getState().selectedNodeId).toBe('n1');
        await waitFor(() => {
            expect((screen.getByTestId('workflow-node-n1') as HTMLDivElement).style.boxShadow).toContain('59, 130, 246');
        });

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

    it('closes zoom preset menu when clicking outside', async () => {
        render(<GraphEditor/>);

        fireEvent.click(screen.getByTestId('zoom-ratio-button'));
        expect(screen.getByRole('button', {name: '50%'})).toBeTruthy();

        fireEvent.pointerDown(document.body);
        await waitFor(() => {
            expect(screen.queryByRole('button', {name: '50%'})).toBeNull();
        });
    });

    it('keeps edge marker color aligned with source port type', async () => {
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
        addNodeFromDrawer('mock.output');

        useGraphStore.getState().setEdges([
            {
                source_node: 'n1',
                source_port: 'text',
                target_node: 'n2',
                target_port: 'in',
                queue_maxsize: 0,
            },
        ]);

        await waitFor(() => {
            const markerPolyline = document.querySelector('.react-flow__arrowhead polyline') as SVGPolylineElement | null;
            expect(markerPolyline).toBeTruthy();
            expect(markerPolyline?.getAttribute('style') ?? '').toContain('stroke: #3b82f6');
        });
    });
});
