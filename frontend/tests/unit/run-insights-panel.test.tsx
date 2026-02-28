import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {http, HttpResponse} from 'msw';
import {beforeEach, describe, expect, it} from 'vitest';

import {RunInsightsPanel} from '../../src/features/runtime-console/RunInsightsPanel';
import {resetRunStore, useRunStore} from '../../src/shared/state/run-store';
import {server} from '../mocks/server';

describe('RunInsightsPanel', () => {
    beforeEach(() => {
        resetRunStore();
    });

    it('shows empty state when run is not started', () => {
        render(<RunInsightsPanel/>);
        expect(screen.getByTestId('run-insights-empty').textContent).toContain('启动一次运行');
    });

    it('loads metrics and diagnostics for active run', async () => {
        useRunStore.getState().attachRun('run_t8', 'running');
        server.use(
            http.get('*/api/v1/runs/run_t8/metrics', () =>
                HttpResponse.json({
                    run_id: 'run_t8',
                    graph_id: 'g1',
                    status: 'running',
                    created_at: 1_700_000_000,
                    started_at: 1_700_000_001,
                    ended_at: null,
                    task_done: false,
                    graph_metrics: {
                        event_total: 10,
                    },
                    node_metrics: {
                        n1: {},
                    },
                    edge_metrics: [{edge: 'n1.out->n2.in'}],
                }),
            ),
            http.get('*/api/v1/runs/run_t8/diagnostics', () =>
                HttpResponse.json({
                    run_id: 'run_t8',
                    graph_id: 'g1',
                    status: 'running',
                    task_done: false,
                    last_error: null,
                    failed_nodes: [{node_id: 'n2'}],
                    slow_nodes_top: [{node_id: 'n1'}],
                    edge_hotspots_top: [{edge: 'n1.out->n2.in'}],
                }),
            ),
        );

        render(<RunInsightsPanel/>);

        await waitFor(() => {
            expect(screen.getByTestId('run-insights-metrics').textContent).toContain('图指标键数量: 1');
            expect(screen.getByTestId('run-insights-diagnostics').textContent).toContain('失败节点数: 1');
        });
    });

    it('refreshes insights when refresh button is clicked', async () => {
        useRunStore.getState().attachRun('run_t8_refresh', 'running');
        let metricsHits = 0;
        let diagnosticsHits = 0;

        server.use(
            http.get('*/api/v1/runs/run_t8_refresh/metrics', () => {
                metricsHits += 1;
                return HttpResponse.json({
                    run_id: 'run_t8_refresh',
                    graph_id: 'g1',
                    status: 'running',
                    created_at: 1_700_000_000,
                    started_at: 1_700_000_001,
                    ended_at: null,
                    task_done: false,
                    graph_metrics: {},
                    node_metrics: {},
                    edge_metrics: [],
                });
            }),
            http.get('*/api/v1/runs/run_t8_refresh/diagnostics', () => {
                diagnosticsHits += 1;
                return HttpResponse.json({
                    run_id: 'run_t8_refresh',
                    graph_id: 'g1',
                    status: 'running',
                    task_done: false,
                    last_error: null,
                    failed_nodes: [],
                    slow_nodes_top: [],
                    edge_hotspots_top: [],
                });
            }),
        );

        render(<RunInsightsPanel/>);
        await waitFor(() => expect(metricsHits).toBeGreaterThanOrEqual(1));

        fireEvent.click(screen.getByRole('button', {name: '刷新'}));
        await waitFor(() => expect(metricsHits).toBeGreaterThanOrEqual(2));
        expect(diagnosticsHits).toBeGreaterThanOrEqual(2);
    });

    it('ignores stale responses from previous run switch', async () => {
        let releaseOldMetrics: (() => void) | null = null;
        let releaseOldDiagnostics: (() => void) | null = null;
        const oldMetricsGate = new Promise<void>((resolve) => {
            releaseOldMetrics = resolve;
        });
        const oldDiagnosticsGate = new Promise<void>((resolve) => {
            releaseOldDiagnostics = resolve;
        });

        server.use(
            http.get('*/api/v1/runs/run_t8_old/metrics', async () => {
                await oldMetricsGate;
                return HttpResponse.json({
                    run_id: 'run_t8_old',
                    graph_id: 'g_old',
                    status: 'running',
                    created_at: 1_700_000_000,
                    started_at: 1_700_000_001,
                    ended_at: null,
                    task_done: false,
                    graph_metrics: {event_total: 1},
                    node_metrics: {n_old: {}},
                    edge_metrics: [{edge: 'n_old.out->n_old2.in'}],
                });
            }),
            http.get('*/api/v1/runs/run_t8_old/diagnostics', async () => {
                await oldDiagnosticsGate;
                return HttpResponse.json({
                    run_id: 'run_t8_old',
                    graph_id: 'g_old',
                    status: 'running',
                    task_done: false,
                    last_error: null,
                    failed_nodes: [{node_id: 'n_old'}],
                    slow_nodes_top: [{node_id: 'n_old'}],
                    edge_hotspots_top: [{edge: 'n_old.out->n_old2.in'}],
                });
            }),
            http.get('*/api/v1/runs/run_t8_new/metrics', () =>
                HttpResponse.json({
                    run_id: 'run_t8_new',
                    graph_id: 'g_new',
                    status: 'running',
                    created_at: 1_700_000_100,
                    started_at: 1_700_000_101,
                    ended_at: null,
                    task_done: false,
                    graph_metrics: {event_total: 9, latency_ms: 22},
                    node_metrics: {n1: {}, n2: {}},
                    edge_metrics: [{edge: 'n1.out->n2.in'}, {edge: 'n2.out->n3.in'}],
                }),
            ),
            http.get('*/api/v1/runs/run_t8_new/diagnostics', () =>
                HttpResponse.json({
                    run_id: 'run_t8_new',
                    graph_id: 'g_new',
                    status: 'running',
                    task_done: false,
                    last_error: null,
                    failed_nodes: [{node_id: 'n2'}, {node_id: 'n3'}],
                    slow_nodes_top: [{node_id: 'n1'}, {node_id: 'n2'}],
                    edge_hotspots_top: [{edge: 'n1.out->n2.in'}, {edge: 'n2.out->n3.in'}],
                }),
            ),
        );

        useRunStore.getState().attachRun('run_t8_old', 'running');
        render(<RunInsightsPanel/>);

        useRunStore.getState().attachRun('run_t8_new', 'running');
        await waitFor(() => {
            expect(screen.getByTestId('run-insights-metrics').textContent).toContain('图指标键数量: 2');
            expect(screen.getByTestId('run-insights-diagnostics').textContent).toContain('失败节点数: 2');
        });

        releaseOldMetrics?.();
        releaseOldDiagnostics?.();

        await waitFor(() => {
            expect(screen.getByTestId('run-insights-metrics').textContent).toContain('图指标键数量: 2');
            expect(screen.getByTestId('run-insights-diagnostics').textContent).toContain('失败节点数: 2');
        });
    });

    it('shows error when insights requests fail (edge path)', async () => {
        useRunStore.getState().attachRun('run_t8_fail', 'running');
        server.use(
            http.get('*/api/v1/runs/run_t8_fail/metrics', () =>
                HttpResponse.json(
                    {detail: 'run not found'},
                    {
                        status: 404,
                    },
                ),
            ),
            http.get('*/api/v1/runs/run_t8_fail/diagnostics', () =>
                HttpResponse.json(
                    {detail: 'run not found'},
                    {
                        status: 404,
                    },
                ),
            ),
        );

        render(<RunInsightsPanel/>);

        await waitFor(() => {
            expect(screen.getByTestId('run-insights-error').textContent).toContain('加载运行洞察失败');
        });
    });
});
