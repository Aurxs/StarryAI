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

    it('switches editor mode and triggers canvas commands (edge path)', () => {
        useUiStore.getState().setEditorMode('hand');
        useUiStore.getState().setNodeLibraryOpen(true);
        useUiStore.getState().requestAutoLayout();
        useUiStore.getState().requestFitCanvas();

        const state = useUiStore.getState();
        expect(state.editorMode).toBe('hand');
        expect(state.nodeLibraryOpen).toBe(true);
        expect(state.autoLayoutRequestTick).toBe(1);
        expect(state.fitCanvasRequestTick).toBe(1);
    });
});
