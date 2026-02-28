import {fireEvent, render, screen} from '@testing-library/react';
import {beforeEach, describe, expect, it} from 'vitest';

import {WorkbenchPage} from '../../src/pages/workbench/WorkbenchPage';
import {resetGraphStore, useGraphStore} from '../../src/shared/state/graph-store';
import {resetRunStore, useRunStore} from '../../src/shared/state/run-store';
import {
    resetRuntimeConsoleStore,
    useRuntimeConsoleStore,
} from '../../src/shared/state/console-store';
import {resetUiStore, useUiStore} from '../../src/shared/state/ui-store';

describe('WorkbenchPage shell', () => {
    beforeEach(() => {
        resetGraphStore();
        resetRunStore();
        resetRuntimeConsoleStore();
        resetUiStore();
    });

    it('renders store summaries on the page', () => {
        useGraphStore.getState().setGraphMeta('graph_t2');
        useGraphStore.getState().upsertNode({
            node_id: 'n1',
            type_name: 'mock.input',
            title: 'Input',
            config: {},
        });
        useGraphStore.getState().setEdges([
            {
                source_node: 'n1',
                source_port: 'text',
                target_node: 'n2',
                target_port: 'in',
                queue_maxsize: 0,
            },
        ]);
        useGraphStore.getState().selectNode('n1');
        useRunStore.getState().attachRun('run_t2');
        useRuntimeConsoleStore.getState().appendEvents([
            {
                run_id: 'run_t2',
                event_id: 'evt_1',
                event_seq: 1,
                event_type: 'run_started',
                severity: 'info',
                component: 'scheduler',
                ts: 1_700_000_000,
                node_id: null,
                edge_key: null,
                error_code: null,
                attempt: null,
                message: null,
                details: {},
            },
        ]);

        render(<WorkbenchPage/>);

        expect(screen.getByTestId('summary-graph-id').textContent).toContain('graph_t2');
        expect(screen.getByTestId('summary-node-count').textContent).toContain('1');
        expect(screen.getByTestId('summary-edge-count').textContent).toContain('1');
        expect(screen.getByTestId('selected-node').textContent).toContain('n1');
        expect(screen.getByTestId('run-status').textContent).toContain('运行中');
        expect(screen.getByTestId('run-id').textContent).toContain('run_t2');
        expect(screen.getByTestId('runtime-console-summary').textContent).toContain('事件数=1');
    });

    it('switches panel tabs through UI interactions (edge path)', () => {
        render(<WorkbenchPage/>);

        fireEvent.click(screen.getByRole('button', {name: '图结构'}));
        fireEvent.click(screen.getByRole('button', {name: '运行洞察'}));

        expect(useUiStore.getState().leftPanel).toBe('graph-outline');
        expect(useUiStore.getState().rightPanel).toBe('run-inspector');
        expect(screen.getByTestId('left-panel-value').textContent).toContain('图结构');
        expect(screen.getByTestId('right-panel-value').textContent).toContain('运行洞察');
    });
});
