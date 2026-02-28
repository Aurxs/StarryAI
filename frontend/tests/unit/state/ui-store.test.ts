import {beforeEach, describe, expect, it} from 'vitest';

import {resetUiStore, useUiStore} from '../../../src/shared/state/ui-store';

describe('ui store', () => {
    beforeEach(() => {
        resetUiStore();
    });

    it('switches left and right panel tabs', () => {
        useUiStore.getState().setLeftPanel('graph-outline');
        useUiStore.getState().setRightPanel('run-inspector');

        const state = useUiStore.getState();
        expect(state.leftPanel).toBe('graph-outline');
        expect(state.rightPanel).toBe('run-inspector');
    });

    it('resets layout to defaults (edge path)', () => {
        useUiStore.getState().setLeftPanel('graph-outline');
        useUiStore.getState().setRightPanel('run-inspector');
        useUiStore.getState().resetLayout();

        const state = useUiStore.getState();
        expect(state.leftPanel).toBe('node-library');
        expect(state.rightPanel).toBe('node-config');
    });
});
