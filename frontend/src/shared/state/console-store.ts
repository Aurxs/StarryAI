import {create} from 'zustand';

import type {
    GetRunEventsParams,
    RuntimeEvent,
    RuntimeEventSeverity,
    RuntimeEventType,
} from '../../entities/workbench/types';

export interface RuntimeConsoleFilters
    extends Pick<GetRunEventsParams, 'event_type' | 'node_id' | 'severity' | 'error_code'> {
}

export interface RuntimeConsoleState {
    events: RuntimeEvent[];
    filters: RuntimeConsoleFilters;
    lastCursor: number;
    appendEvents: (events: RuntimeEvent[]) => void;
    clearEvents: () => void;
    setFilters: (patch: Partial<RuntimeConsoleFilters>) => void;
    setCursor: (nextCursor: number) => void;
}

const createInitialFilters = (): RuntimeConsoleFilters => ({
    event_type: undefined as RuntimeEventType | undefined,
    node_id: undefined,
    severity: undefined as RuntimeEventSeverity | undefined,
    error_code: undefined,
});

const createInitialState = (): Pick<RuntimeConsoleState, 'events' | 'filters' | 'lastCursor'> => ({
    events: [],
    filters: createInitialFilters(),
    lastCursor: 0,
});

export const useRuntimeConsoleStore = create<RuntimeConsoleState>((set) => ({
    ...createInitialState(),
    appendEvents: (events) =>
        set((state) => {
            if (!events.length) {
                return state;
            }

            const dedupedById = new Map<string, RuntimeEvent>();
            for (const item of state.events) {
                dedupedById.set(item.event_id, item);
            }
            for (const item of events) {
                dedupedById.set(item.event_id, item);
            }

            const merged = Array.from(dedupedById.values()).sort((left, right) => left.event_seq - right.event_seq);
            return {
                events: merged,
            };
        }),
    clearEvents: () =>
        set(() => ({
            events: [],
            lastCursor: 0,
        })),
    setFilters: (patch) =>
        set((state) => {
            const nextFilters: RuntimeConsoleFilters = {
                ...state.filters,
                ...patch,
            };
            const filtersChanged =
                nextFilters.event_type !== state.filters.event_type ||
                nextFilters.node_id !== state.filters.node_id ||
                nextFilters.severity !== state.filters.severity ||
                nextFilters.error_code !== state.filters.error_code;
            if (!filtersChanged) {
                return state;
            }
            return {
                filters: nextFilters,
                events: [],
                lastCursor: 0,
            };
        }),
    setCursor: (nextCursor) =>
        set((state) => ({
            lastCursor: Math.max(state.lastCursor, Math.max(0, nextCursor)),
        })),
}));

export const resetRuntimeConsoleStore = (): void => {
    useRuntimeConsoleStore.setState(createInitialState());
};
