import {create} from 'zustand';

import {isRunActiveStatus} from '../run-status';

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
            isBusy: isRunActiveStatus(status),
        })),
    attachRun: (runId, status = 'running') =>
        set(() => ({
            runId: runId.trim() || null,
            status,
            isBusy: isRunActiveStatus(status),
            lastError: null,
        })),
    setError: (message) => set(() => ({lastError: message})),
    clearRun: () => set(() => createInitialState()),
}));

export const resetRunStore = (): void => {
    useRunStore.setState(createInitialState());
};
