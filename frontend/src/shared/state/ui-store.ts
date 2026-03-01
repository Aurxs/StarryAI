import {create} from 'zustand';

export type LeftPanelKey = 'node-library' | 'graph-outline';
export type RightPanelKey = 'node-config' | 'run-inspector';
export type EditorMode = 'pointer' | 'hand';

export interface UiState {
    leftPanel: LeftPanelKey;
    rightPanel: RightPanelKey;
    editorMode: EditorMode;
    nodeLibraryOpen: boolean;
    reviewDrawerOpen: boolean;
    historyDrawerOpen: boolean;
    zoomMenuOpen: boolean;
    fitCanvasRequestTick: number;
    autoLayoutRequestTick: number;
    setLeftPanel: (panel: LeftPanelKey) => void;
    setRightPanel: (panel: RightPanelKey) => void;
    setEditorMode: (mode: EditorMode) => void;
    setNodeLibraryOpen: (open: boolean) => void;
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
    | 'editorMode'
    | 'nodeLibraryOpen'
    | 'reviewDrawerOpen'
    | 'historyDrawerOpen'
    | 'zoomMenuOpen'
    | 'fitCanvasRequestTick'
    | 'autoLayoutRequestTick'
> => ({
    leftPanel: 'node-library',
    rightPanel: 'node-config',
    editorMode: 'pointer',
    nodeLibraryOpen: false,
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
    setEditorMode: (mode) => set(() => ({editorMode: mode})),
    setNodeLibraryOpen: (open) => set(() => ({nodeLibraryOpen: open})),
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
