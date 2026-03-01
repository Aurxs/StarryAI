import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {http, HttpResponse} from 'msw';
import {beforeEach, describe, expect, it} from 'vitest';

import {GraphValidationPanel} from '../../src/features/run-control/GraphValidationPanel';
import {resetGraphStore, useGraphStore} from '../../src/shared/state/graph-store';
import {resetRunStore, useRunStore} from '../../src/shared/state/run-store';
import {server} from '../mocks/server';

describe('GraphValidationPanel', () => {
    beforeEach(() => {
        resetGraphStore();
        resetRunStore();
    });

    it('shows not-validated state by default', () => {
        render(<GraphValidationPanel/>);
        expect(screen.getByTestId('validation-summary').textContent).toContain('还未校验');
    });

    it('stores valid result after successful validation request', async () => {
        server.use(
            http.post('*/api/v1/graphs/validate', async ({request}) => {
                const body = (await request.json()) as { graph_id: string };
                return HttpResponse.json({
                    graph_id: body.graph_id,
                    valid: true,
                    issues: [],
                });
            }),
        );

        render(<GraphValidationPanel/>);
        fireEvent.click(screen.getByRole('button', {name: '校验图'}));

        await waitFor(() => {
            expect(screen.getByTestId('validation-summary').textContent).toContain('结果: 通过');
        });

        expect(useGraphStore.getState().validationValid).toBe(true);
        expect(useGraphStore.getState().validationIssues).toHaveLength(0);
    });

    it('stores issues and supports clear action', async () => {
        server.use(
            http.post('*/api/v1/graphs/validate', () =>
                HttpResponse.json({
                    graph_id: 'graph_phase_e',
                    valid: false,
                    issues: [
                        {
                            level: 'error',
                            code: 'edge.schema_mismatch',
                            message: '边 schema 不兼容: n1.text -> n2.in',
                        },
                    ],
                }),
            ),
        );

        render(<GraphValidationPanel/>);
        fireEvent.click(screen.getByRole('button', {name: '校验图'}));

        await waitFor(() => {
            expect(screen.getByTestId('validation-summary').textContent).toContain('结果: 未通过');
        });
        expect(screen.getByText(/edge\.schema_mismatch/)).toBeTruthy();

        fireEvent.click(screen.getByRole('button', {name: '清空'}));
        expect(useGraphStore.getState().validationCheckedAt).toBeNull();
        expect(useGraphStore.getState().validationIssues).toHaveLength(0);
    });

    it('maps request failure to client-side issue code (edge path)', async () => {
        server.use(
            http.post('*/api/v1/graphs/validate', () =>
                HttpResponse.json(
                    {detail: 'service unavailable'},
                    {
                        status: 503,
                    },
                ),
            ),
        );

        render(<GraphValidationPanel/>);
        fireEvent.click(screen.getByRole('button', {name: '校验图'}));

        await waitFor(() => {
            expect(useRunStore.getState().status).toBe('failed');
        });

        const issues = useGraphStore.getState().validationIssues;
        expect(issues[0]?.code).toBe('client.validation_request_failed');
    });

    it('reconciles sync-managed config before validation request', async () => {
        let capturedBody: Record<string, unknown> | null = null;
        server.use(
            http.post('*/api/v1/graphs/validate', async ({request}) => {
                capturedBody = (await request.json()) as Record<string, unknown>;
                return HttpResponse.json({
                    graph_id: 'graph_phase_e',
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
                    sync_group: 'group_1',
                    sync_round: 2,
                    ready_timeout_ms: 1200,
                    commit_lead_ms: 90,
                },
            },
            {
                node_id: 'n_exec',
                type_name: 'audio.play.sync',
                title: 'executor',
                config: {
                    volume: 0.8,
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

        render(<GraphValidationPanel/>);
        fireEvent.click(screen.getByRole('button', {name: '校验图'}));

        await waitFor(() => {
            expect(capturedBody).not.toBeNull();
        });

        const requestNodes = (capturedBody?.nodes ?? []) as Array<Record<string, unknown>>;
        const executor = requestNodes.find((node) => node.node_id === 'n_exec');
        expect(executor?.config).toMatchObject({
            volume: 0.8,
            sync_group: 'group_1',
            sync_round: 2,
            ready_timeout_ms: 1200,
            commit_lead_ms: 90,
            __sync_managed_by: 'n_init',
        });

        const executorInStore = useGraphStore
            .getState()
            .graph.nodes.find((node) => node.node_id === 'n_exec');
        expect(executorInStore?.config).toMatchObject({
            sync_group: 'group_1',
            sync_round: 2,
            ready_timeout_ms: 1200,
            commit_lead_ms: 90,
            __sync_managed_by: 'n_init',
        });
    });
});
