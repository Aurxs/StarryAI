import {create} from 'zustand';

export type LeftPanelKey = 'node-library' | 'graph-outline';
export type RightPanelKey = 'node-config' | 'run-inspector';
export type EditorMode = 'pointer' | 'hand';
export type LeftDrawerKey = 'node-library' | 'variable-manager';

export interface UiState {
    leftPanel: LeftPanelKey;
    rightPanel: RightPanelKey;
    leftDrawer: LeftDrawerKey | null;
    editorMode: EditorMode;
    reviewDrawerOpen: boolean;
    historyDrawerOpen: boolean;
    zoomMenuOpen: boolean;
    fitCanvasRequestTick: number;
    autoLayoutRequestTick: number;
    setLeftPanel: (panel: LeftPanelKey) => void;
    setRightPanel: (panel: RightPanelKey) => void;
    setLeftDrawer: (drawer: LeftDrawerKey | null) => void;
    setEditorMode: (mode: EditorMode) => void;
    setReviewDrawerOpen: (open: boolean) => void;
    setHistoryDrawerOpen: (open: boolean) => void;
    setZoomMenuOpen: (open: boolean) => void;
    requestFitCanvas: () => void;
    requestAutoLayout: () => void;
    resetLayout: () => void;
}

const createInitialState = (): Pick<
    UiState,
    | 'leftPanel'
    | 'rightPanel'
    | 'leftDrawer'
    | 'editorMode'
    | 'reviewDrawerOpen'
    | 'historyDrawerOpen'
    | 'zoomMenuOpen'
    | 'fitCanvasRequestTick'
    | 'autoLayoutRequestTick'
> => ({
    leftPanel: 'node-library',
    rightPanel: 'node-config',
    leftDrawer: null,
    editorMode: 'pointer',
    reviewDrawerOpen: false,
    historyDrawerOpen: false,
    zoomMenuOpen: false,
    fitCanvasRequestTick: 0,
    autoLayoutRequestTick: 0,
});

export const useUiStore = create<UiState>((set) => ({
    ...createInitialState(),
    setLeftPanel: (panel) => set(() => ({leftPanel: panel})),
    setRightPanel: (panel) => set(() => ({rightPanel: panel})),
    setLeftDrawer: (drawer) => set(() => ({leftDrawer: drawer})),
    setEditorMode: (mode) => set(() => ({editorMode: mode})),
    setReviewDrawerOpen: (open) => set(() => ({reviewDrawerOpen: open})),
    setHistoryDrawerOpen: (open) => set(() => ({historyDrawerOpen: open})),
    setZoomMenuOpen: (open) => set(() => ({zoomMenuOpen: open})),
    requestFitCanvas: () =>
        set((state) => ({
            fitCanvasRequestTick: state.fitCanvasRequestTick + 1,
        })),
    requestAutoLayout: () =>
        set((state) => ({
            autoLayoutRequestTick: state.autoLayoutRequestTick + 1,
        })),
    resetLayout: () => set(() => createInitialState()),
}));

export const resetUiStore = (): void => {
    useUiStore.setState(createInitialState());
};
