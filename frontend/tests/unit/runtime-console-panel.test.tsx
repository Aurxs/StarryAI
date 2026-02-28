import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {http, HttpResponse} from 'msw';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {RuntimeConsolePanel} from '../../src/features/runtime-console/RuntimeConsolePanel';
import {resetRunStore, useRunStore} from '../../src/shared/state/run-store';
import {
    resetRuntimeConsoleStore,
    useRuntimeConsoleStore,
} from '../../src/shared/state/console-store';
import {server} from '../mocks/server';

class FakeWebSocket {
    static instances: FakeWebSocket[] = [];

    readonly url: string;
    onopen: (() => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;
    readyState = 0;

    constructor(url: string) {
        this.url = url;
        FakeWebSocket.instances.push(this);
    }

    close(): void {
        this.readyState = 3;
        this.onclose?.();
    }

    emitOpen(): void {
        this.readyState = 1;
        this.onopen?.();
    }

    emitMessage(raw: string): void {
        this.onmessage?.({data: raw} as MessageEvent);
    }
}

describe('RuntimeConsolePanel', () => {
    beforeEach(() => {
        resetRunStore();
        resetRuntimeConsoleStore();
        FakeWebSocket.instances = [];
        vi.stubGlobal('WebSocket', FakeWebSocket);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('keeps controls disabled when no run is active', () => {
        render(<RuntimeConsolePanel/>);

        expect((screen.getByRole('button', {name: 'Load Events'}) as HTMLButtonElement).disabled).toBe(
            true,
        );
        expect(
            (screen.getByRole('button', {name: 'Subscribe WS'}) as HTMLButtonElement).disabled,
        ).toBe(true);
        expect(screen.getByTestId('runtime-console-empty').textContent).toContain('No events yet');
    });

    it('keeps preloaded events/cursor on initial mount for the same run', () => {
        useRunStore.getState().attachRun('run_t7_preloaded');
        useRuntimeConsoleStore.getState().appendEvents([
            {
                run_id: 'run_t7_preloaded',
                event_id: 'evt_preloaded_1',
                event_seq: 21,
                event_type: 'node_finished',
                severity: 'info',
                component: 'node',
                ts: 1_700_000_111,
                node_id: 'n1',
                edge_key: null,
                error_code: null,
                attempt: null,
                message: null,
                details: {},
            },
        ]);
        useRuntimeConsoleStore.getState().setCursor(22);

        render(<RuntimeConsolePanel/>);

        expect(useRuntimeConsoleStore.getState().events).toHaveLength(1);
        expect(useRuntimeConsoleStore.getState().lastCursor).toBe(22);
        expect(screen.getByTestId('runtime-console-summary').textContent).toContain('events=1');
    });

    it('loads events from REST endpoint and updates cursor', async () => {
        useRunStore.getState().attachRun('run_t7_rest');
        server.use(
            http.get('*/api/v1/runs/run_t7_rest/events', () =>
                HttpResponse.json({
                    run_id: 'run_t7_rest',
                    next_cursor: 12,
                    count: 1,
                    items: [
                        {
                            run_id: 'run_t7_rest',
                            event_id: 'evt_rest_1',
                            event_seq: 11,
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
                    ],
                }),
            ),
        );

        render(<RuntimeConsolePanel/>);
        fireEvent.click(screen.getByRole('button', {name: 'Load Events'}));

        await waitFor(() => {
            expect(useRuntimeConsoleStore.getState().events).toHaveLength(1);
            expect(useRuntimeConsoleStore.getState().lastCursor).toBe(12);
        });
    });

    it('resets events/cursor when switching run and restarts since from zero', async () => {
        useRunStore.getState().attachRun('run_t7_old');
        useRuntimeConsoleStore.getState().appendEvents([
            {
                run_id: 'run_t7_old',
                event_id: 'evt_old_1',
                event_seq: 40,
                event_type: 'node_started',
                severity: 'info',
                component: 'node',
                ts: 1_700_000_000,
                node_id: 'n1',
                edge_key: null,
                error_code: null,
                attempt: null,
                message: null,
                details: {},
            },
        ]);
        useRuntimeConsoleStore.getState().setCursor(41);

        let requestedSince: string | null = null;
        server.use(
            http.get('*/api/v1/runs/run_t7_new/events', ({request}) => {
                requestedSince = new URL(request.url).searchParams.get('since');
                return HttpResponse.json({
                    run_id: 'run_t7_new',
                    next_cursor: 0,
                    count: 0,
                    items: [],
                });
            }),
        );

        render(<RuntimeConsolePanel/>);

        useRunStore.getState().attachRun('run_t7_new');
        await waitFor(() => {
            expect(useRuntimeConsoleStore.getState().events).toHaveLength(0);
            expect(useRuntimeConsoleStore.getState().lastCursor).toBe(0);
        });

        fireEvent.click(screen.getByRole('button', {name: 'Load Events'}));
        await waitFor(() => {
            expect(requestedSince).toBe('0');
        });
    });

    it('updates filters through inputs', () => {
        useRunStore.getState().attachRun('run_t7_filters');
        render(<RuntimeConsolePanel/>);

        fireEvent.change(screen.getByLabelText('filter-event-type'), {
            target: {value: 'node_failed'},
        });
        fireEvent.change(screen.getByLabelText('filter-severity'), {
            target: {value: 'error'},
        });
        fireEvent.change(screen.getByLabelText('filter-node-id'), {
            target: {value: 'n4'},
        });
        fireEvent.change(screen.getByLabelText('filter-error-code'), {
            target: {value: 'node.execution_failed'},
        });

        const filters = useRuntimeConsoleStore.getState().filters;
        expect(filters.event_type).toBe('node_failed');
        expect(filters.severity).toBe('error');
        expect(filters.node_id).toBe('n4');
        expect(filters.error_code).toBe('node.execution_failed');
    });

    it('receives ws events and handles invalid ws payload (edge path)', async () => {
        useRunStore.getState().attachRun('run_t7_ws');
        render(<RuntimeConsolePanel/>);

        fireEvent.click(screen.getByRole('button', {name: 'Subscribe WS'}));
        const ws = FakeWebSocket.instances[0];
        expect(ws).toBeTruthy();
        ws?.emitOpen();
        ws?.emitMessage(
            JSON.stringify({
                run_id: 'run_t7_ws',
                event_id: 'evt_ws_1',
                event_seq: 2,
                event_type: 'node_started',
                severity: 'info',
                component: 'node',
                ts: 1_700_000_001,
                node_id: 'n1',
                edge_key: null,
                error_code: null,
                attempt: null,
                message: null,
                details: {},
            }),
        );
        ws?.emitMessage('invalid-json');

        await waitFor(() => {
            expect(useRuntimeConsoleStore.getState().events).toHaveLength(1);
            expect(screen.getByTestId('runtime-console-error').textContent).toContain(
                'ws message parse failed',
            );
        });
    });
});
