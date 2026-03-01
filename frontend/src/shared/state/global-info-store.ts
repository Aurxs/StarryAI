import {create} from 'zustand';

interface GlobalInfoState {
    message: string | null;
    messageSeq: number;
    show: (message: string) => void;
    clear: () => void;
}

export const useGlobalInfoStore = create<GlobalInfoState>((set) => ({
    message: null,
    messageSeq: 0,
    show: (message) =>
        set((state) => ({
            message,
            messageSeq: state.messageSeq + 1,
        })),
    clear: () => set(() => ({message: null})),
}));

export const pushGlobalInfoMessage = (message: string): void => {
    const normalized = message.trim();
    if (!normalized) {
        return;
    }
    useGlobalInfoStore.getState().show(normalized);
};

export const clearGlobalInfoMessage = (): void => {
    useGlobalInfoStore.getState().clear();
};

