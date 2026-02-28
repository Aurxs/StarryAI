import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {http, HttpResponse} from 'msw';
import {beforeEach, describe, expect, it} from 'vitest';

import {RunControlPanel} from '../../src/features/run-control/RunControlPanel';
import {resetGraphStore} from '../../src/shared/state/graph-store';
import {resetRunStore, useRunStore} from '../../src/shared/state/run-store';
import {server} from '../mocks/server';

describe('RunControlPanel', () => {
    beforeEach(() => {
        resetGraphStore();
        resetRunStore();
    });

    it('starts run successfully and stores run id/status', async () => {
        server.use(
            http.post('*/api/v1/runs', () =>
                HttpResponse.json({
                    run_id: 'run_t6_start',
                    graph_id: 'graph_phase_e',
                    status: 'running',
                }),
            ),
            http.get('*/api/v1/runs/:runId', ({params}) =>
                HttpResponse.json({
                    run_id: params.runId,
                    graph_id: 'graph_phase_e',
                    status: 'running',
                    created_at: 1_700_000_000,
                    started_at: 1_700_000_001,
                    ended_at: null,
                    stream_id: 'stream_frontend',
                    last_error: null,
                    task_done: false,
                    metrics: {},
                    node_states: {},
                    edge_states: [],
                }),
            ),
        );

        render(<RunControlPanel/>);
        fireEvent.click(screen.getByRole('button', {name: 'Start Run'}));

        await waitFor(() => {
            expect(screen.getByTestId('run-control-summary').textContent).toContain('run_t6_start');
            expect(screen.getByTestId('run-control-summary').textContent).toContain('status=running');
        });
    });

    it('stops active run successfully', async () => {
        server.use(
            http.post('*/api/v1/runs', () =>
                HttpResponse.json({
                    run_id: 'run_t6_stop',
                    graph_id: 'graph_phase_e',
                    status: 'running',
                }),
            ),
            http.post('*/api/v1/runs/run_t6_stop/stop', () =>
                HttpResponse.json({
                    run_id: 'run_t6_stop',
                    status: 'stopped',
                }),
            ),
            http.get('*/api/v1/runs/:runId', ({params}) =>
                HttpResponse.json({
                    run_id: params.runId,
                    graph_id: 'graph_phase_e',
                    status: 'running',
                    created_at: 1_700_000_000,
                    started_at: 1_700_000_001,
                    ended_at: null,
                    stream_id: 'stream_frontend',
                    last_error: null,
                    task_done: false,
                    metrics: {},
                    node_states: {},
                    edge_states: [],
                }),
            ),
        );

        render(<RunControlPanel/>);
        fireEvent.click(screen.getByRole('button', {name: 'Start Run'}));
        await waitFor(() => expect(useRunStore.getState().runId).toBe('run_t6_stop'));

        fireEvent.click(screen.getByRole('button', {name: 'Stop Run'}));
        await waitFor(() => {
            expect(screen.getByTestId('run-control-summary').textContent).toContain('status=stopped');
        });
    });

    it('shows create-run error for 422 response (error path)', async () => {
        server.use(
            http.post('*/api/v1/runs', () =>
                HttpResponse.json(
                    {
                        detail: {
                            message: 'Graph validation failed before execution',
                        },
                    },
                    {
                        status: 422,
                    },
                ),
            ),
        );

        render(<RunControlPanel/>);
        fireEvent.click(screen.getByRole('button', {name: 'Start Run'}));

        await waitFor(() => {
            expect(screen.getByTestId('run-control-error').textContent).toContain('run create failed');
            expect(useRunStore.getState().status).toBe('failed');
        });
    });

    it('polls status and transitions to completed (edge path)', async () => {
        let pollCount = 0;
        server.use(
            http.post('*/api/v1/runs', () =>
                HttpResponse.json({
                    run_id: 'run_t6_poll',
                    graph_id: 'graph_phase_e',
                    status: 'running',
                }),
            ),
            http.get('*/api/v1/runs/run_t6_poll', () => {
                pollCount += 1;
                return HttpResponse.json({
                    run_id: 'run_t6_poll',
                    graph_id: 'graph_phase_e',
                    status: pollCount > 1 ? 'completed' : 'running',
                    created_at: 1_700_000_000,
                    started_at: 1_700_000_001,
                    ended_at: pollCount > 1 ? 1_700_000_002 : null,
                    stream_id: 'stream_frontend',
                    last_error: null,
                    task_done: pollCount > 1,
                    metrics: {},
                    node_states: {},
                    edge_states: [],
                });
            }),
        );

        render(<RunControlPanel/>);
        fireEvent.click(screen.getByRole('button', {name: 'Start Run'}));

        await waitFor(
            () => {
                expect(useRunStore.getState().status).toBe('completed');
            },
            {timeout: 2500},
        );
    });
});
