import {create} from 'zustand';

import type {
    CreateSecretRequest,
    RotateSecretRequest,
    SecretCatalogEntry,
    SecretUsageResponse,
    UpdateSecretRequest,
} from '../../entities/workbench/types';
import {apiClient} from '../api/client';

interface SecretState {
    items: SecretCatalogEntry[];
    loading: boolean;
    error: string | null;
    loadSecrets: () => Promise<void>;
    createSecret: (request: CreateSecretRequest) => Promise<SecretCatalogEntry>;
    updateSecret: (secretId: string, request: UpdateSecretRequest) => Promise<SecretCatalogEntry>;
    rotateSecret: (secretId: string, request: RotateSecretRequest) => Promise<SecretCatalogEntry>;
    deleteSecret: (secretId: string) => Promise<void>;
    getUsage: (secretId: string) => Promise<SecretUsageResponse>;
    clearError: () => void;
}

const sortSecrets = (items: SecretCatalogEntry[]): SecretCatalogEntry[] =>
    [...items].sort((left, right) => left.label.localeCompare(right.label, undefined, {sensitivity: 'base'}));

const upsertSecret = (
    items: SecretCatalogEntry[],
    nextItem: SecretCatalogEntry,
): SecretCatalogEntry[] => {
    const nextItems = items.filter((item) => item.secret_id !== nextItem.secret_id);
    nextItems.push(nextItem);
    return sortSecrets(nextItems);
};

export const useSecretStore = create<SecretState>((set, get) => ({
    items: [],
    loading: false,
    error: null,
    loadSecrets: async () => {
        set(() => ({loading: true, error: null}));
        try {
            const payload = await apiClient.listSecrets();
            set(() => ({items: sortSecrets(payload.items), loading: false}));
        } catch (error) {
            set(() => ({loading: false, error: String(error)}));
            throw error;
        }
    },
    createSecret: async (request) => {
        const created = await apiClient.createSecret(request);
        set((state) => ({items: upsertSecret(state.items, created), error: null}));
        return created;
    },
    updateSecret: async (secretId, request) => {
        const updated = await apiClient.updateSecret(secretId, request);
        set((state) => ({items: upsertSecret(state.items, updated), error: null}));
        return updated;
    },
    rotateSecret: async (secretId, request) => {
        const updated = await apiClient.rotateSecret(secretId, request);
        set((state) => ({items: upsertSecret(state.items, updated), error: null}));
        return updated;
    },
    deleteSecret: async (secretId) => {
        await apiClient.deleteSecret(secretId);
        set((state) => ({items: state.items.filter((item) => item.secret_id !== secretId), error: null}));
    },
    getUsage: (secretId) => apiClient.getSecretUsage(secretId),
    clearError: () => set(() => ({error: null})),
}));

export const resetSecretStore = (): void => {
    useSecretStore.setState({
        items: [],
        loading: false,
        error: null,
        loadSecrets: useSecretStore.getState().loadSecrets,
        createSecret: useSecretStore.getState().createSecret,
        updateSecret: useSecretStore.getState().updateSecret,
        rotateSecret: useSecretStore.getState().rotateSecret,
        deleteSecret: useSecretStore.getState().deleteSecret,
        getUsage: useSecretStore.getState().getUsage,
        clearError: useSecretStore.getState().clearError,
    });
};
