import {beforeEach, describe, expect, it} from 'vitest';

import {resetRunStore, useRunStore} from '../../../src/shared/state/run-store';

describe('run store', () => {
    beforeEach(() => {
        resetRunStore();
    });

    it('tracks validating/running as busy and stores run id', () => {
        useRunStore.getState().setStatus('validating');
        expect(useRunStore.getState().isBusy).toBe(true);

        useRunStore.getState().attachRun('run_t2');
        const state = useRunStore.getState();
        expect(state.runId).toBe('run_t2');
        expect(state.status).toBe('running');
        expect(state.isBusy).toBe(true);
    });

    it('stores and clears error messages', () => {
        useRunStore.getState().setError('node failed');
        expect(useRunStore.getState().lastError).toBe('node failed');

        useRunStore.getState().setError(null);
        expect(useRunStore.getState().lastError).toBeNull();
    });

    it('resets to idle after clearRun (edge path)', () => {
        useRunStore.getState().attachRun('run_active', 'running');
        useRunStore.getState().setError('x');
        useRunStore.getState().clearRun();

        const state = useRunStore.getState();
        expect(state.runId).toBeNull();
        expect(state.status).toBe('idle');
        expect(state.isBusy).toBe(false);
        expect(state.lastError).toBeNull();
    });
});
