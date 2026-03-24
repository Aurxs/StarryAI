import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {http, HttpResponse} from 'msw';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {WorkbenchPage} from '../../src/pages/workbench/WorkbenchPage';
import {resetGraphStore, useGraphStore} from '../../src/shared/state/graph-store';
import {resetRunStore, useRunStore} from '../../src/shared/state/run-store';
import {resetUiStore, useUiStore} from '../../src/shared/state/ui-store';
import {server} from '../mocks/server';

describe('WorkbenchPage shell', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

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

    it('edits project name on single click in collapsed mode', async () => {
        render(<WorkbenchPage/>);

        const nameButton = screen.getByTestId('project-name-display') as HTMLButtonElement;
        fireEvent.click(nameButton);

        const input = screen.getByLabelText('project-name-input') as HTMLInputElement;
        fireEvent.change(input, {target: {value: 'graph_renamed'}});
        fireEvent.blur(input);

        await waitFor(() => {
            expect(useGraphStore.getState().graph.graph_id).toBe('graph_renamed');
        });
    });

    it('shows an asterisk next to project name when graph has unsaved changes', async () => {
        render(<WorkbenchPage/>);

        expect(screen.getByTestId('project-name-display').textContent).toBe('graph_new');

        useGraphStore.getState().upsertNode({
            node_id: 'n_dirty',
            type_name: 'mock.input',
            title: 'Input',
            config: {},
        });

        await waitFor(() => {
            expect(screen.getByTestId('project-name-display').textContent).toBe('graph_new*');
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

    it('supports Ctrl/Cmd+S save shortcut', async () => {
        let capturedGraphId: string | null = null;
        server.use(
            http.put('*/api/v1/graphs/:graphId', async ({params, request}) => {
                const body = (await request.json()) as Record<string, unknown>;
                capturedGraphId = String(body.graph_id ?? params.graphId ?? '');
                return HttpResponse.json({
                    graph_id: params.graphId,
                    version: '0.1.0',
                    updated_at: 1_700_000_123,
                });
            }),
        );

        render(<WorkbenchPage/>);

        fireEvent.keyDown(window, {key: 's', ctrlKey: true});
        await waitFor(() => {
            expect(capturedGraphId).toBe('graph_new');
        });
    });

    it('does not trigger graph undo while editing the project name input', async () => {
        render(<WorkbenchPage/>);

        useGraphStore.getState().upsertNode({
            node_id: 'n1',
            type_name: 'mock.input',
            title: 'Input',
            config: {},
        });

        await waitFor(() => {
            expect(useGraphStore.getState().graph.nodes).toHaveLength(1);
        });
        fireEvent.click(screen.getByTestId('project-name-display'));
        const input = screen.getByLabelText('project-name-input');
        fireEvent.keyDown(input, {key: 'z', ctrlKey: true});

        expect(useGraphStore.getState().graph.nodes).toHaveLength(1);
    });

    it('does not trigger graph undo while editing node config json', async () => {
        useGraphStore.getState().upsertNode({
            node_id: 'n_json',
            type_name: 'mock.output',
            title: 'Output',
            config: {enabled: true},
        });
        useGraphStore.getState().selectNode('n_json');

        render(<WorkbenchPage/>);
        const jsonInput = await screen.findByTestId('node-config-json-input');
        fireEvent.keyDown(jsonInput, {key: 'z', ctrlKey: true});

        expect(useGraphStore.getState().graph.nodes).toHaveLength(1);
        expect(useGraphStore.getState().selectedNodeId).toBe('n_json');
    });

    it('creates a new graph from persistence panel', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);

        useGraphStore.getState().upsertNode({
            node_id: 'n1',
            type_name: 'mock.input',
            title: 'Input',
            config: {},
        });

        render(<WorkbenchPage/>);
        fireEvent.click(screen.getByTestId('graph-panel-expand'));

        await waitFor(() => {
            expect(screen.getByRole('button', {name: '新建'})).toBeTruthy();
        });

        fireEvent.click(screen.getByRole('button', {name: '新建'}));

        await waitFor(() => {
            const graph = useGraphStore.getState().graph;
            expect(graph.nodes).toHaveLength(0);
            expect(graph.edges).toHaveLength(0);
            expect(graph.graph_id).toBe('graph_new');
        });
        expect(window.confirm).toHaveBeenCalledTimes(1);
    });

    it('adds numeric suffix for default new graph id when saved graphs conflict', async () => {
        server.use(
            http.get('*/api/v1/graphs', () =>
                HttpResponse.json({
                    count: 2,
                    items: [
                        {graph_id: 'graph_new', version: '0.1.0', updated_at: 1_700_000_001},
                        {graph_id: 'graph_new_1', version: '0.1.0', updated_at: 1_700_000_002},
                    ],
                }),
            ),
        );

        render(<WorkbenchPage/>);

        await waitFor(() => {
            expect(useGraphStore.getState().graph.graph_id).toBe('graph_new_2');
        });
        expect(useGraphStore.getState().isDirty).toBe(false);
    });

    it('shows incompatibility hint only for incompatible graphs and disables their load button', async () => {
        server.use(
            http.get('*/api/v1/graphs', () =>
                HttpResponse.json({
                    count: 2,
                    items: [
                        {
                            graph_id: 'graph_ok',
                            version: '0.1.0',
                            updated_at: 1_700_000_001,
                            incompatibility: null,
                        },
                        {
                            graph_id: 'graph_bad',
                            version: '1.0.0',
                            updated_at: 1_700_000_002,
                            incompatibility: {
                                code: 'compat.graph_major_unsupported',
                                message: '图结构主版本不受支持',
                            },
                        },
                    ],
                }),
            ),
        );

        render(<WorkbenchPage/>);
        fireEvent.click(screen.getByTestId('graph-panel-expand'));

        const okTitle = await screen.findByText('graph_ok');
        const badTitle = await screen.findByText('graph_bad');

        const okItem = okTitle.closest('li');
        const badItem = badTitle.closest('li');
        expect(okItem).toBeTruthy();
        expect(badItem).toBeTruthy();
        if (!okItem || !badItem) {
            throw new Error('saved graph list item not found');
        }

        expect(
            within(okItem).queryByTestId('saved-graph-incompatibility-graph_ok'),
        ).toBeNull();
        expect(
            within(badItem).getByTestId('saved-graph-incompatibility-graph_bad').textContent,
        ).toContain('图结构主版本不受支持');

        const okLoadButton = within(okItem).getByRole('button', {name: '加载'}) as HTMLButtonElement;
        const badLoadButton = within(badItem).getByRole('button', {name: '加载'}) as HTMLButtonElement;
        expect(okLoadButton.disabled).toBe(false);
        expect(badLoadButton.disabled).toBe(true);
    });

    it('shows sync commit/abort metrics in run panel', async () => {
        server.use(
            http.post('*/api/v1/runs', async ({request}) => {
                await request.json();
                return HttpResponse.json({
                    run_id: 'run_sync_panel',
                    graph_id: 'graph_new',
                    status: 'running',
                });
            }),
            http.get('*/api/v1/runs/run_sync_panel', () =>
                HttpResponse.json({
                    run_id: 'run_sync_panel',
                    graph_id: 'graph_new',
                    status: 'completed',
                    created_at: 1_700_000_000,
                    started_at: 1_700_000_001,
                    ended_at: 1_700_000_002,
                    stream_id: 'stream_frontend',
                    last_error: null,
                    task_done: true,
                    metrics: {},
                    node_states: {},
                    edge_states: [],
                }),
            ),
            http.get('*/api/v1/runs/run_sync_panel/metrics', () =>
                HttpResponse.json({
                    run_id: 'run_sync_panel',
                    graph_id: 'graph_new',
                    status: 'completed',
                    created_at: 1_700_000_000,
                    started_at: 1_700_000_001,
                    ended_at: 1_700_000_002,
                    task_done: true,
                    graph_metrics: {},
                    node_metrics: {
                        n_audio: {
                            sync_committed: 1,
                            sync_aborted: 0,
                            sync_abort_reason: '',
                        },
                        n_motion: {
                            sync_committed: 0,
                            sync_aborted: 1,
                            sync_abort_reason: 'timeout',
                        },
                    },
                    edge_metrics: [],
                }),
            ),
        );

        useGraphStore.getState().upsertNode({
            node_id: 'n1',
            type_name: 'mock.input',
            title: 'Input',
            config: {},
        });
        useGraphStore.getState().setValidationResult(true, []);

        render(<WorkbenchPage/>);
        const runButton = screen.getByRole('button', {name: '测试运行'});
        await waitFor(() => {
            expect((screen.getByRole('button', {name: '测试运行'}) as HTMLButtonElement).disabled).toBe(false);
        });
        fireEvent.click(runButton);

        await waitFor(() => {
            const panel = screen.getByTestId('run-sync-metrics');
            expect(panel.textContent).toContain('同步提交: 1');
            expect(panel.textContent).toContain('同步中止: 1');
            expect(panel.textContent).toContain('timeout(1)');
        });
    });

    it('reconciles sync-managed config in auto-review validation flow', async () => {
        let capturedValidateBody: Record<string, unknown> | null = null;
        server.use(
            http.post('*/api/v1/graphs/validate', async ({request}) => {
                capturedValidateBody = (await request.json()) as Record<string, unknown>;
                return HttpResponse.json({
                    graph_id: 'graph_new',
                    valid: true,
                    issues: [],
                });
            }),
        );

        useGraphStore.getState().setNodes([
            {
                node_id: 'n_init',
                type_name: 'sync.initiator.dual',
                title: 'initiator',
                config: {
                    sync_group: 'group_review',
                    sync_round: 4,
                    ready_timeout_ms: 1400,
                    commit_lead_ms: 100,
                },
            },
            {
                node_id: 'n_exec',
                type_name: 'audio.play.sync',
                title: 'executor',
                config: {
                    volume: 0.7,
                },
            },
        ]);
        useGraphStore.getState().setEdges([
            {
                source_node: 'n_init',
                source_port: 'out_a',
                target_node: 'n_exec',
                target_port: 'in',
                queue_maxsize: 0,
            },
        ]);

        render(<WorkbenchPage/>);

        await waitFor(() => {
            expect(capturedValidateBody).not.toBeNull();
        });

        const requestNodes = (capturedValidateBody?.nodes ?? []) as Array<Record<string, unknown>>;
        const executorInRequest = requestNodes.find((node) => node.node_id === 'n_exec');
        expect(executorInRequest?.config).toMatchObject({
            volume: 0.7,
            sync_group: 'group_review',
            sync_round: 4,
            ready_timeout_ms: 1400,
            commit_lead_ms: 100,
            __sync_managed_by: 'n_init',
        });

        const executorInStore = useGraphStore
            .getState()
            .graph.nodes.find((node) => node.node_id === 'n_exec');
        expect(executorInStore?.config).toMatchObject({
            sync_group: 'group_review',
            sync_round: 4,
            ready_timeout_ms: 1400,
            commit_lead_ms: 100,
            __sync_managed_by: 'n_init',
        });
    });
});
