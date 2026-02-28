import {beforeEach, describe, expect, it} from 'vitest';

import type {RuntimeEvent} from '../../../src/entities/workbench/types';
import {
    resetRuntimeConsoleStore,
    useRuntimeConsoleStore,
} from '../../../src/shared/state/console-store';

const eventFixture = (eventId: string, seq: number): RuntimeEvent => ({
    run_id: 'run_t2',
    event_id: eventId,
    event_seq: seq,
    event_type: 'node_started',
    severity: 'info',
    component: 'node',
    ts: 1_700_000_000 + seq,
    node_id: 'n1',
    edge_key: null,
    error_code: null,
    attempt: null,
    message: null,
    details: {},
});

describe('runtime console store', () => {
    beforeEach(() => {
        resetRuntimeConsoleStore();
    });

    it('deduplicates event_id and keeps event_seq ordering', () => {
        useRuntimeConsoleStore.getState().appendEvents([
            eventFixture('evt_2', 2),
            eventFixture('evt_1', 1),
        ]);
        useRuntimeConsoleStore.getState().appendEvents([
            {
                ...eventFixture('evt_2', 2),
                message: 'updated',
            },
        ]);

        const state = useRuntimeConsoleStore.getState();
        expect(state.events).toHaveLength(2);
        expect(state.events.map((item) => item.event_id)).toEqual(['evt_1', 'evt_2']);
        expect(state.events[1]?.message).toBe('updated');
    });

    it('keeps cursor monotonic even when smaller cursor arrives (edge path)', () => {
        useRuntimeConsoleStore.getState().setCursor(8);
        useRuntimeConsoleStore.getState().setCursor(3);

        expect(useRuntimeConsoleStore.getState().lastCursor).toBe(8);
    });

    it('resets events/cursor when filters change', () => {
        useRuntimeConsoleStore.getState().appendEvents([eventFixture('evt_3', 3)]);
        useRuntimeConsoleStore.getState().setCursor(9);
        useRuntimeConsoleStore.getState().setFilters({
            event_type: 'node_failed',
            severity: 'error',
        });

        const state = useRuntimeConsoleStore.getState();
        expect(state.filters.event_type).toBe('node_failed');
        expect(state.filters.severity).toBe('error');
        expect(state.events).toHaveLength(0);
        expect(state.lastCursor).toBe(0);
    });

    it('keeps events/cursor when filter patch does not change values', () => {
        useRuntimeConsoleStore.getState().setFilters({
            event_type: 'node_failed',
        });
        useRuntimeConsoleStore.getState().appendEvents([eventFixture('evt_4', 4)]);
        useRuntimeConsoleStore.getState().setCursor(10);
        useRuntimeConsoleStore.getState().setFilters({
            event_type: 'node_failed',
        });

        const state = useRuntimeConsoleStore.getState();
        expect(state.filters.event_type).toBe('node_failed');
        expect(state.events).toHaveLength(1);
        expect(state.lastCursor).toBe(10);
    });
});
