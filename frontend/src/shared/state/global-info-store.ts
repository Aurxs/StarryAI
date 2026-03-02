import {create} from 'zustand';

export type GlobalInfoLevel = 'info' | 'success' | 'warning' | 'error';

export interface GlobalInfoMessage {
    id: number;
    message: string;
    level: GlobalInfoLevel;
}

interface GlobalInfoState {
    messages: GlobalInfoMessage[];
    messageSeq: number;
    show: (message: string, level?: GlobalInfoLevel) => void;
    dequeue: () => void;
    removeById: (id: number) => void;
    clear: () => void;
}

export const useGlobalInfoStore = create<GlobalInfoState>((set) => ({
    messages: [],
    messageSeq: 0,
    show: (message, level = 'info') =>
        set((state) => ({
            messageSeq: state.messageSeq + 1,
            messages: [
                ...state.messages,
                {
                    id: state.messageSeq + 1,
                    message,
                    level,
                },
            ],
        })),
    dequeue: () =>
        set((state) => ({
            messages: state.messages.length <= 1 ? [] : state.messages.slice(1),
        })),
    removeById: (id) =>
        set((state) => ({
            messages: state.messages.filter((message) => message.id !== id),
        })),
    clear: () => set(() => ({messages: []})),
}));

export const pushGlobalInfoMessage = (message: string, level: GlobalInfoLevel = 'info'): void => {
    const normalized = message.trim();
    if (!normalized) {
        return;
    }
    useGlobalInfoStore.getState().show(normalized, level);
};

export const dequeueGlobalInfoMessage = (): void => {
    useGlobalInfoStore.getState().dequeue();
};

export const removeGlobalInfoMessageById = (id: number): void => {
    useGlobalInfoStore.getState().removeById(id);
};

export const clearGlobalInfoMessage = (): void => {
    useGlobalInfoStore.getState().clear();
};

export const resetGlobalInfoStore = (): void => {
    useGlobalInfoStore.setState({
        messages: [],
        messageSeq: 0,
    });
};

export const notifyUser = {
    info: (message: string): void => pushGlobalInfoMessage(message, 'info'),
    success: (message: string): void => pushGlobalInfoMessage(message, 'success'),
    warning: (message: string): void => pushGlobalInfoMessage(message, 'warning'),
    error: (message: string): void => pushGlobalInfoMessage(message, 'error'),
    clear: (): void => clearGlobalInfoMessage(),
};
