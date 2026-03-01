import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it} from 'vitest';

import {WorkbenchPage} from '../../src/pages/workbench/WorkbenchPage';
import {localeStorageKey} from '../../src/shared/i18n/i18n';
import {resetGraphStore, useGraphStore} from '../../src/shared/state/graph-store';
import {resetRunStore, useRunStore} from '../../src/shared/state/run-store';
import {resetUiStore, useUiStore} from '../../src/shared/state/ui-store';

describe('WorkbenchPage shell', () => {
    beforeEach(() => {
        resetGraphStore();
        resetRunStore();
        resetUiStore();
    });

    it('renders project switcher, run action and review bar', () => {
        render(<WorkbenchPage/>);

        expect(screen.getByRole('button', {name: '当前项目名称 ↓'})).toBeTruthy();
        expect(screen.getByRole('button', {name: '▶ 测试运行'})).toBeTruthy();
        expect(screen.getByTestId('review-bar').textContent).toContain('审查');
    });

    it('resets editor mode to hand when entering workbench', () => {
        useUiStore.getState().setEditorMode('hand');

        render(<WorkbenchPage/>);

        expect(useUiStore.getState().editorMode).toBe('hand');
    });

    it('opens project menu and switches language with persistence', async () => {
        render(<WorkbenchPage/>);

        fireEvent.click(screen.getByRole('button', {name: '当前项目名称 ↓'}));
        fireEvent.change(screen.getByTestId('language-switch'), {
            target: {value: 'en-US'},
        });

        await waitFor(() => {
            expect(screen.getByRole('button', {name: '▶ Run Test'})).toBeTruthy();
        });
        expect(window.localStorage.getItem(localeStorageKey)).toBe('en-US');
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

        fireEvent.click(screen.getByRole('button', {name: '⏱'}));
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
            expect((screen.getByRole('button', {name: '↶'}) as HTMLButtonElement).disabled).toBe(false);
        });
        fireEvent.click(screen.getByRole('button', {name: '↶'}));
        await waitFor(() => {
            expect(useGraphStore.getState().graph.nodes).toHaveLength(0);
        });

        await waitFor(() => {
            expect((screen.getByRole('button', {name: '↷'}) as HTMLButtonElement).disabled).toBe(false);
        });
        fireEvent.click(screen.getByRole('button', {name: '↷'}));
        await waitFor(() => {
            expect(useGraphStore.getState().graph.nodes).toHaveLength(1);
        });
    });

    it('gates run action until review has no errors', async () => {
        render(<WorkbenchPage/>);

        const runButton = screen.getByRole('button', {name: '▶ 测试运行'}) as HTMLButtonElement;
        expect(runButton.disabled).toBe(true);

        useGraphStore.getState().setValidationResult(true, []);
        await waitFor(() => {
            expect((screen.getByRole('button', {name: '▶ 测试运行'}) as HTMLButtonElement).disabled).toBe(false);
        });

        useRunStore.getState().setError(null);
    });
});
