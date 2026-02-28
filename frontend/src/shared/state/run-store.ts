import {create} from 'zustand';

export type RunUiStatus =
    | 'idle'
    | 'validating'
    | 'running'
    | 'stopped'
    | 'completed'
    | 'failed';

export interface RunState {
    runId: string | null;
    status: RunUiStatus;
    isBusy: boolean;
    lastError: string | null;
    setStatus: (status: RunUiStatus) => void;
    attachRun: (runId: string, status?: RunUiStatus) => void;
    setBusy: (busy: boolean) => void;
    setError: (message: string | null) => void;
    clearRun: () => void;
}

const createInitialState = (): Pick<RunState, 'runId' | 'status' | 'isBusy' | 'lastError'> => ({
    runId: null,
    status: 'idle',
    isBusy: false,
    lastError: null,
});

export const useRunStore = create<RunState>((set) => ({
    ...createInitialState(),
    setStatus: (status) =>
        set(() => ({
            status,
            isBusy: status === 'validating' || status === 'running',
        })),
    attachRun: (runId, status = 'running') =>
        set(() => ({
            runId: runId.trim() || null,
            status,
            isBusy: status === 'validating' || status === 'running',
            lastError: null,
        })),
    setBusy: (busy) => set(() => ({isBusy: busy})),
    setError: (message) => set(() => ({lastError: message})),
    clearRun: () => set(() => createInitialState()),
}));

export const resetRunStore = (): void => {
    useRunStore.setState(createInitialState());
};
