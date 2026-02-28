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
});
