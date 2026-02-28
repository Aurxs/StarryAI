import {create} from 'zustand';

export type LeftPanelKey = 'node-library' | 'graph-outline';
export type RightPanelKey = 'node-config' | 'run-inspector';

export interface UiState {
    leftPanel: LeftPanelKey;
    rightPanel: RightPanelKey;
    setLeftPanel: (panel: LeftPanelKey) => void;
    setRightPanel: (panel: RightPanelKey) => void;
    resetLayout: () => void;
}

const createInitialState = (): Pick<UiState, 'leftPanel' | 'rightPanel'> => ({
    leftPanel: 'node-library',
    rightPanel: 'node-config',
});

export const useUiStore = create<UiState>((set) => ({
    ...createInitialState(),
    setLeftPanel: (panel) => set(() => ({leftPanel: panel})),
    setRightPanel: (panel) => set(() => ({rightPanel: panel})),
    resetLayout: () => set(() => createInitialState()),
}));

export const resetUiStore = (): void => {
    useUiStore.setState(createInitialState());
};
