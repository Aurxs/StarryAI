import {useEffect, useMemo, useState, type CSSProperties} from 'react';
import {KeyRound, Pencil, Plus, RefreshCw, Trash2} from 'lucide-react';
import {useTranslation} from 'react-i18next';

import type {CreateSecretRequest, SecretCatalogEntry, UpdateSecretRequest} from '../../entities/workbench/types';
import {ApiClientError} from '../../shared/api/client';
import {translateSecretKind, translateSecretProvider} from '../../shared/i18n/label-mappers';
import {useSecretStore} from '../../shared/state/secret-store';
import {SecretEditorDialog} from './SecretEditorDialog';

const panelStyle: CSSProperties = {
    display: 'grid',
    gap: 12,
};

const toolbarStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
};

const buttonStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    background: '#ffffff',
    color: '#334155',
    cursor: 'pointer',
    padding: '7px 10px',
    fontSize: 12,
};

const primaryButtonStyle: CSSProperties = {
    ...buttonStyle,
    borderColor: '#0f172a',
    background: '#0f172a',
    color: '#f8fafc',
};

const searchInputStyle: CSSProperties = {
    flex: 1,
    minWidth: 0,
    boxSizing: 'border-box',
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    padding: '8px 10px',
    fontSize: 13,
    color: '#0f172a',
    background: '#ffffff',
};

const listStyle: CSSProperties = {
    display: 'grid',
    gap: 10,
    paddingRight: 2,
};

const cardStyle: CSSProperties = {
    border: '1px solid #dce3ee',
    borderRadius: 12,
    padding: 12,
    display: 'grid',
    gap: 8,
    background: '#f8fafc',
};

const metaRowStyle: CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    fontSize: 11,
    color: '#475569',
};

const pillStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    border: '1px solid #cbd5e1',
    borderRadius: 999,
    padding: '2px 8px',
    background: '#ffffff',
};

const actionsStyle: CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
};

const warningStyle: CSSProperties = {
    fontSize: 12,
    color: '#92400e',
    background: '#fffbeb',
    border: '1px solid #fcd34d',
    borderRadius: 10,
    padding: '8px 10px',
};

type DialogState =
    | {mode: 'create'; item: null}
    | {mode: 'edit'; item: SecretCatalogEntry}
    | {mode: 'rotate'; item: SecretCatalogEntry}
    | null;

const formatTimestamp = (value: number): string => new Date(value * 1000).toLocaleString();

interface SecretManagerPanelProps {
    listMaxHeight?: number | null;
}

export function SecretManagerPanel({listMaxHeight = 340}: SecretManagerPanelProps = {}) {
    const {t} = useTranslation();
    const items = useSecretStore((state) => state.items);
    const loading = useSecretStore((state) => state.loading);
    const storeError = useSecretStore((state) => state.error);
    const loadSecrets = useSecretStore((state) => state.loadSecrets);
    const createSecret = useSecretStore((state) => state.createSecret);
    const updateSecret = useSecretStore((state) => state.updateSecret);
    const rotateSecret = useSecretStore((state) => state.rotateSecret);
    const deleteSecret = useSecretStore((state) => state.deleteSecret);
    const clearError = useSecretStore((state) => state.clearError);

    const [search, setSearch] = useState('');
    const [dialogState, setDialogState] = useState<DialogState>(null);
    const [requestBusy, setRequestBusy] = useState(false);
    const [panelError, setPanelError] = useState<string | null>(null);
    const [providerUnavailable, setProviderUnavailable] = useState(false);

    const isProviderUnavailableError = (error: unknown): boolean =>
        error instanceof ApiClientError && error.status === 503;

    useEffect(() => {
        void loadSecrets().catch((error) => {
            setProviderUnavailable(isProviderUnavailableError(error));
        });
    }, [loadSecrets]);

    const filteredItems = useMemo(() => {
        const keyword = search.trim().toLowerCase();
        if (!keyword) {
            return items;
        }
        return items.filter((item) =>
            [item.label, item.secret_id, item.kind, item.description]
                .join(' ')
                .toLowerCase()
                .includes(keyword),
        );
    }, [items, search]);

    const requestErrorMessage = panelError ?? storeError;

    const handleCreate = async (request: CreateSecretRequest): Promise<void> => {
        setRequestBusy(true);
        setPanelError(null);
        clearError();
        try {
            await createSecret(request);
            setDialogState(null);
            await loadSecrets();
            setProviderUnavailable(false);
        } catch (error) {
            setProviderUnavailable(isProviderUnavailableError(error));
            setPanelError(error instanceof ApiClientError ? error.message : String(error));
            throw error;
        } finally {
            setRequestBusy(false);
        }
    };

    const handleUpdate = async (secretId: string, request: UpdateSecretRequest): Promise<void> => {
        setRequestBusy(true);
        setPanelError(null);
        clearError();
        try {
            await updateSecret(secretId, request);
            setDialogState(null);
            await loadSecrets();
            setProviderUnavailable(false);
        } catch (error) {
            setProviderUnavailable(isProviderUnavailableError(error));
            setPanelError(error instanceof ApiClientError ? error.message : String(error));
            throw error;
        } finally {
            setRequestBusy(false);
        }
    };

    const handleRotate = async (secretId: string, value: string): Promise<void> => {
        setRequestBusy(true);
        setPanelError(null);
        clearError();
        try {
            await rotateSecret(secretId, {value});
            setDialogState(null);
            await loadSecrets();
            setProviderUnavailable(false);
        } catch (error) {
            setProviderUnavailable(isProviderUnavailableError(error));
            setPanelError(error instanceof ApiClientError ? error.message : String(error));
            throw error;
        } finally {
            setRequestBusy(false);
        }
    };

    const handleDelete = async (item: SecretCatalogEntry): Promise<void> => {
        const confirmed = window.confirm(t('secretManager.actions.deleteConfirm', {label: item.label}));
        if (!confirmed) {
            return;
        }
        setPanelError(null);
        clearError();
        try {
            await deleteSecret(item.secret_id);
            await loadSecrets();
            setProviderUnavailable(false);
        } catch (error) {
            setProviderUnavailable(isProviderUnavailableError(error));
            setPanelError(error instanceof ApiClientError ? error.message : String(error));
        }
    };

    return (
        <section style={panelStyle} data-testid="secret-manager-panel">
            <div style={toolbarStyle}>
                <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={t('secretManager.searchPlaceholder')}
                    style={searchInputStyle}
                    aria-label={t('secretManager.searchPlaceholder')}
                />
                <button type="button" style={buttonStyle} onClick={() => void loadSecrets()} disabled={loading}>
                    <RefreshCw size={14} aria-hidden="true"/>
                    {loading ? t('secretManager.actions.loading') : t('secretManager.actions.refresh')}
                </button>
                <button
                    type="button"
                    style={primaryButtonStyle}
                    onClick={() => setDialogState({mode: 'create', item: null})}
                    disabled={providerUnavailable}
                >
                    <Plus size={14} aria-hidden="true"/>
                    {t('secretManager.actions.create')}
                </button>
            </div>

            <div style={{fontSize: 12, color: '#475569'}}>
                {t('secretManager.summary', {count: items.length})}
            </div>

            {requestErrorMessage && (
                <div style={{fontSize: 12, color: '#9f1239'}} data-testid="secret-manager-error">
                    {requestErrorMessage}
                </div>
            )}

            {providerUnavailable && (
                <div style={warningStyle} data-testid="secret-manager-provider-warning">
                    {t('secretManager.security.providerUnavailable')}
                </div>
            )}

            <div
                style={{
                    ...listStyle,
                    ...(typeof listMaxHeight === 'number' && listMaxHeight > 0
                        ? {maxHeight: listMaxHeight, overflowY: 'auto'}
                        : {}),
                }}
            >
                {filteredItems.length === 0 ? (
                    <div style={{fontSize: 13, color: '#64748b'}}>{t('secretManager.empty')}</div>
                ) : (
                    filteredItems.map((item) => (
                        <article key={item.secret_id} style={cardStyle}>
                            <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12}}>
                                <div>
                                    <div style={{fontSize: 14, fontWeight: 700, color: '#0f172a'}}>{item.label}</div>
                                    <div style={{fontSize: 12, color: '#475569'}}>{item.secret_id}</div>
                                </div>
                                <div style={{fontSize: 11, color: item.in_use ? '#15803d' : '#475569'}}>
                                    {t(item.in_use ? 'secretManager.inUse' : 'secretManager.notInUse')}
                                </div>
                            </div>
                            <div style={metaRowStyle}>
                                <span style={pillStyle}>
                                    {t('secretManager.meta.kind', {kind: translateSecretKind(t, item.kind)})}
                                </span>
                                <span style={pillStyle}>
                                    {t('secretManager.meta.provider', {provider: translateSecretProvider(t, item.provider)})}
                                </span>
                                <span style={pillStyle}>{t('secretManager.meta.usage', {count: item.usage_count})}</span>
                            </div>
                            {item.description && (
                                <div style={{fontSize: 12, color: '#334155'}}>{item.description}</div>
                            )}
                            <div style={{fontSize: 11, color: '#64748b'}}>
                                {t('secretManager.meta.updatedAt', {time: formatTimestamp(item.updated_at)})}
                            </div>
                            <div style={actionsStyle}>
                                <button type="button" style={buttonStyle} onClick={() => setDialogState({mode: 'edit', item})}>
                                    <Pencil size={14} aria-hidden="true"/>
                                    {t('secretManager.actions.edit')}
                                </button>
                                <button
                                    type="button"
                                    style={buttonStyle}
                                    onClick={() => setDialogState({mode: 'rotate', item})}
                                    disabled={providerUnavailable}
                                >
                                    <KeyRound size={14} aria-hidden="true"/>
                                    {t('secretManager.actions.rotate')}
                                </button>
                                <button type="button" style={buttonStyle} onClick={() => void handleDelete(item)}>
                                    <Trash2 size={14} aria-hidden="true"/>
                                    {t('secretManager.actions.delete')}
                                </button>
                            </div>
                        </article>
                    ))
                )}
            </div>

            {dialogState && (
                <SecretEditorDialog
                    mode={dialogState.mode}
                    item={dialogState.item}
                    submitting={requestBusy}
                    errorMessage={requestErrorMessage}
                    onClose={() => {
                        if (!requestBusy) {
                            setDialogState(null);
                            setPanelError(null);
                            clearError();
                        }
                    }}
                    onCreate={handleCreate}
                    onUpdate={handleUpdate}
                    onRotate={handleRotate}
                />
            )}
        </section>
    );
}
