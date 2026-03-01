import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it} from 'vitest';

import {WorkbenchPage} from '../../src/pages/workbench/WorkbenchPage';
import {resetGraphStore, useGraphStore} from '../../src/shared/state/graph-store';
import {resetRunStore, useRunStore} from '../../src/shared/state/run-store';
import {resetUiStore, useUiStore} from '../../src/shared/state/ui-store';

describe('WorkbenchPage shell', () => {
    beforeEach(() => {
        resetGraphStore();
        resetRunStore();
        resetUiStore();
    });

    it('renders collapsed persistence panel, run action and review bar', () => {
        render(<WorkbenchPage/>);

        expect(screen.getByTestId('graph-persistence-panel')).toBeTruthy();
        expect(screen.getByTestId('project-name-display')).toBeTruthy();
        expect(screen.getByTestId('graph-panel-expand')).toBeTruthy();
        expect(screen.getByRole('button', {name: '测试运行'})).toBeTruthy();
        expect(screen.getByTestId('review-bar').textContent).toContain('无问题');
    });

    it('resets editor mode to hand when entering workbench', () => {
        useUiStore.getState().setEditorMode('hand');

        render(<WorkbenchPage/>);

        expect(useUiStore.getState().editorMode).toBe('hand');
    });

    it('expands panel below collapsed row and renders saved list surface', async () => {
        render(<WorkbenchPage/>);

        fireEvent.click(screen.getByTestId('graph-panel-expand'));

        await waitFor(() => {
            expect(screen.getByRole('button', {name: '保存'})).toBeTruthy();
        });
        expect(screen.getByText('暂无已保存图')).toBeTruthy();
        expect(screen.getByTestId('graph-panel-collapse')).toBeTruthy();
    });

    it('collapses expanded surfaces when clicking outside', async () => {
        render(<WorkbenchPage/>);

        fireEvent.click(screen.getByTestId('graph-panel-expand'));
        await waitFor(() => {
            expect(screen.getByTestId('graph-panel-collapse')).toBeTruthy();
        });
        fireEvent.pointerDown(document.body);
        await waitFor(() => {
            expect(screen.getByTestId('graph-panel-expand')).toBeTruthy();
        });

        fireEvent.click(screen.getByRole('button', {name: '打开操作历史'}));
        await waitFor(() => {
            expect(screen.getByLabelText('history-drawer')).toBeTruthy();
        });
        fireEvent.pointerDown(document.body);
        await waitFor(() => {
            expect(screen.queryByLabelText('history-drawer')).toBeNull();
        });

        fireEvent.click(screen.getByTestId('review-bar'));
        await waitFor(() => {
            expect(screen.getByLabelText('review-drawer')).toBeTruthy();
        });
        fireEvent.pointerDown(document.body);
        await waitFor(() => {
            expect(screen.queryByLabelText('review-drawer')).toBeNull();
        });
    });

    it('underlines on click and edits on double click in collapsed mode', async () => {
        render(<WorkbenchPage/>);

        const nameButton = screen.getByTestId('project-name-display') as HTMLButtonElement;
        fireEvent.click(nameButton);
        expect(nameButton.style.textDecoration).toContain('underline');

        fireEvent.doubleClick(nameButton);

        const input = screen.getByLabelText('project-name-input') as HTMLInputElement;
        fireEvent.change(input, {target: {value: 'graph_renamed'}});
        fireEvent.blur(input);

        await waitFor(() => {
            expect(useGraphStore.getState().graph.graph_id).toBe('graph_renamed');
        });
    });

    it('records history entries and opens history drawer', async () => {
        render(<WorkbenchPage/>);

        useGraphStore.getState().upsertNode({
            node_id: 'n1',
            type_name: 'mock.input',
            title: 'Input',
            config: {},
        });
        useGraphStore.getState().patchNode('n1', {title: 'Input Updated'});

        fireEvent.click(screen.getByRole('button', {name: '打开操作历史'}));
        await waitFor(() => {
            expect(screen.getByLabelText('history-drawer')).toBeTruthy();
        });
        expect(screen.getByText(/更新节点配置/)).toBeTruthy();
    });

    it('supports undo/redo buttons for graph edits (edge path)', async () => {
        render(<WorkbenchPage/>);

        useGraphStore.getState().upsertNode({
            node_id: 'n1',
            type_name: 'mock.input',
            title: 'Input',
            config: {},
        });
        expect(useGraphStore.getState().graph.nodes).toHaveLength(1);

        await waitFor(() => {
            expect((screen.getByRole('button', {name: '撤销'}) as HTMLButtonElement).disabled).toBe(false);
        });
        fireEvent.click(screen.getByRole('button', {name: '撤销'}));
        await waitFor(() => {
            expect(useGraphStore.getState().graph.nodes).toHaveLength(0);
        });

        await waitFor(() => {
            expect((screen.getByRole('button', {name: '重做'}) as HTMLButtonElement).disabled).toBe(false);
        });
        fireEvent.click(screen.getByRole('button', {name: '重做'}));
        await waitFor(() => {
            expect(useGraphStore.getState().graph.nodes).toHaveLength(1);
        });
    });

    it('gates run action until review has no errors', async () => {
        render(<WorkbenchPage/>);

        const runButton = screen.getByRole('button', {name: '测试运行'}) as HTMLButtonElement;
        expect(runButton.disabled).toBe(true);

        useGraphStore.setState((state) => ({
            graph: {
                ...state.graph,
                nodes: [
                    {
                        node_id: 'n1',
                        type_name: 'mock.input',
                        title: 'Input',
                        config: {},
                    },
                ],
            },
            isDirty: false,
        }));

        useGraphStore.getState().setValidationResult(true, []);
        await waitFor(() => {
            expect((screen.getByRole('button', {name: '测试运行'}) as HTMLButtonElement).disabled).toBe(false);
        });

        useRunStore.getState().setError(null);
    });

    it('ignores graph.empty_nodes in review surface', async () => {
        render(<WorkbenchPage/>);

        useGraphStore.getState().setValidationResult(false, [
            {
                level: 'error',
                code: 'graph.empty_nodes',
                message: '图中没有节点',
            },
        ]);

        await waitFor(() => {
            expect(screen.getByTestId('review-bar').textContent).not.toContain('有1个问题');
        });

        fireEvent.click(screen.getByTestId('review-bar'));
        await waitFor(() => {
            expect(screen.getByLabelText('review-drawer').textContent).not.toContain('graph.empty_nodes');
        });
    });
});
