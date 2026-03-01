import {useEffect, useMemo, useState, type CSSProperties} from 'react';
import {useTranslation} from 'react-i18next';

import type {NodeSpec} from '../../entities/workbench/types';
import {apiClient} from '../../shared/api/client';
import {useGraphStore} from '../../shared/state/graph-store';
import {
    COMMIT_LEAD_KEY,
    DEFAULT_COMMIT_LEAD_MS,
    DEFAULT_READY_TIMEOUT_MS,
    DEFAULT_SYNC_GROUP,
    DEFAULT_SYNC_ROUND,
    READY_TIMEOUT_KEY,
    SYNC_GROUP_KEY,
    SYNC_MANAGED_BY_KEY,
    SYNC_ROUND_AUTO_KEY,
    SYNC_ROUND_KEY,
    getManagedByNodeId,
    isSyncExecutorNodeType,
    isSyncInitiatorNodeType,
    readManagedSyncConfig,
    stripManagedSyncFields,
} from '../sync-config/managed-config';

const panelStyle: CSSProperties = {
    marginTop: 10,
    border: '1px solid rgba(31, 41, 51, 0.14)',
    borderRadius: 10,
    padding: 10,
    background: 'rgba(248, 250, 252, 0.95)',
    color: '#0f172a',
};

const inputStyle: CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid rgba(31, 41, 51, 0.24)',
    borderRadius: 8,
    padding: '8px 10px',
    fontSize: 13,
    marginTop: 4,
    color: '#0f172a',
    background: '#ffffff',
};

const textareaStyle: CSSProperties = {
    ...inputStyle,
    minHeight: 130,
    resize: 'vertical',
    fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
    lineHeight: 1.4,
};

const buttonStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid rgba(31, 41, 51, 0.2)',
    borderRadius: 8,
    padding: '6px 10px',
    fontSize: 12,
    cursor: 'pointer',
    background: '#ffffff',
    color: '#0f172a',
    marginRight: 8,
    lineHeight: 1.1,
};

const formatJson = (value: Record<string, unknown>): string => JSON.stringify(value, null, 2);

const parseInteger = (value: string): number | null => {
    const trimmed = value.trim();
    if (!trimmed || !/^-?\d+$/.test(trimmed)) {
        return null;
    }
    return Number.parseInt(trimmed, 10);
};

type SyncPanelRole = 'none' | 'initiator' | 'executor';

interface SyncFieldDraft {
    syncGroup: string;
    syncRound: string;
    readyTimeoutMs: string;
    commitLeadMs: string;
}

const createDefaultSyncFieldDraft = (): SyncFieldDraft => ({
    syncGroup: DEFAULT_SYNC_GROUP,
    syncRound: String(DEFAULT_SYNC_ROUND),
    readyTimeoutMs: String(DEFAULT_READY_TIMEOUT_MS),
    commitLeadMs: String(DEFAULT_COMMIT_LEAD_MS),
});

const buildSyncFieldDraft = (config: Record<string, unknown>): SyncFieldDraft => {
    const managed = readManagedSyncConfig(config);
    return {
        syncGroup: managed.sync_group,
        syncRound: String(managed.sync_round),
        readyTimeoutMs: String(managed.ready_timeout_ms),
        commitLeadMs: String(managed.commit_lead_ms),
    };
};

const buildRuntimeConfigDraft = (config: Record<string, unknown>, role: SyncPanelRole): string => {
    if (role === 'none') {
        return formatJson(config);
    }
    return formatJson(stripManagedSyncFields(config));
};

export function NodeConfigPanel() {
    const {t} = useTranslation();
    const selectedNodeId = useGraphStore((state) => state.selectedNodeId);
    const nodes = useGraphStore((state) => state.graph.nodes);
    const patchNode = useGraphStore((state) => state.patchNode);
    const [catalogByType, setCatalogByType] = useState<Map<string, NodeSpec>>(new Map());

    const selectedNode = useMemo(
        () => nodes.find((node) => node.node_id === selectedNodeId) ?? null,
        [nodes, selectedNodeId],
    );
    const selectedSpec = useMemo(
        () => (selectedNode ? catalogByType.get(selectedNode.type_name) ?? null : null),
        [catalogByType, selectedNode],
    );
    const syncRole = useMemo<SyncPanelRole>(() => {
        if (!selectedNode) {
            return 'none';
        }
        const specRole = selectedSpec?.sync_config?.role;
        if (specRole === 'initiator') {
            return 'initiator';
        }
        if (specRole === 'executor') {
            return 'executor';
        }
        if (isSyncInitiatorNodeType(selectedNode.type_name)) {
            return 'initiator';
        }
        if (isSyncExecutorNodeType(selectedNode.type_name)) {
            return 'executor';
        }
        return 'none';
    }, [selectedNode, selectedSpec]);
    const isSyncNode = syncRole !== 'none';
    const managedByNodeId = useMemo(
        () => (selectedNode && syncRole === 'executor' ? getManagedByNodeId(selectedNode.config) : null),
        [selectedNode, syncRole],
    );

    const [titleDraft, setTitleDraft] = useState('');
    const [configDraft, setConfigDraft] = useState('{}');
    const [syncFieldDraft, setSyncFieldDraft] = useState<SyncFieldDraft>(createDefaultSyncFieldDraft());
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        const loadCatalog = async () => {
            try {
                const payload = await apiClient.listNodeTypes();
                if (cancelled) {
                    return;
                }
                const next = new Map<string, NodeSpec>();
                for (const item of payload.items) {
                    next.set(item.type_name, item);
                }
                setCatalogByType(next);
            } catch {
                if (!cancelled) {
                    setCatalogByType(new Map());
                }
            }
        };
        void loadCatalog();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (!selectedNode) {
            setTitleDraft('');
            setConfigDraft('{}');
            setSyncFieldDraft(createDefaultSyncFieldDraft());
            setErrorMessage(null);
            setSuccessMessage(null);
            return;
        }
        setTitleDraft(selectedNode.title);
        setConfigDraft(buildRuntimeConfigDraft(selectedNode.config, syncRole));
        setSyncFieldDraft(buildSyncFieldDraft(selectedNode.config));
        setErrorMessage(null);
        setSuccessMessage(null);
    }, [selectedNode, syncRole]);

    if (!selectedNode) {
        return (
            <section style={panelStyle} data-testid="node-config-empty">
                <h3 style={{marginTop: 0}}>{t('nodeConfig.title')}</h3>
                <p style={{fontSize: 13, opacity: 0.82, marginBottom: 0}}>
                    {t('nodeConfig.emptyPrompt')}
                </p>
            </section>
        );
    }

    const onSave = (): void => {
        const nextTitle = titleDraft.trim() || selectedNode.type_name;
        let parsedRuntimeConfig: Record<string, unknown>;
        try {
            const rawParsed = JSON.parse(configDraft) as unknown;
            if (!rawParsed || typeof rawParsed !== 'object' || Array.isArray(rawParsed)) {
                setErrorMessage(t('nodeConfig.errors.mustBeObject'));
                setSuccessMessage(null);
                return;
            }
            parsedRuntimeConfig = rawParsed as Record<string, unknown>;
        } catch {
            setErrorMessage(t('nodeConfig.errors.invalidJson'));
            setSuccessMessage(null);
            return;
        }

        let parsedConfig: Record<string, unknown> = parsedRuntimeConfig;
        if (syncRole === 'initiator') {
            const syncGroup = syncFieldDraft.syncGroup.trim();
            if (!syncGroup) {
                setErrorMessage(t('nodeConfig.errors.syncGroupRequired'));
                setSuccessMessage(null);
                return;
            }
            const readyTimeoutMs = parseInteger(syncFieldDraft.readyTimeoutMs);
            if (readyTimeoutMs === null || readyTimeoutMs < 1) {
                setErrorMessage(t('nodeConfig.errors.readyTimeoutInvalid'));
                setSuccessMessage(null);
                return;
            }
            const commitLeadMs = parseInteger(syncFieldDraft.commitLeadMs);
            if (commitLeadMs === null || commitLeadMs < 1) {
                setErrorMessage(t('nodeConfig.errors.commitLeadInvalid'));
                setSuccessMessage(null);
                return;
            }
            const existingManaged = readManagedSyncConfig(selectedNode.config);
            parsedConfig = {
                ...parsedRuntimeConfig,
                [SYNC_GROUP_KEY]: syncGroup,
                [SYNC_ROUND_KEY]: existingManaged.sync_round,
                [READY_TIMEOUT_KEY]: readyTimeoutMs,
                [COMMIT_LEAD_KEY]: commitLeadMs,
                [SYNC_ROUND_AUTO_KEY]: true,
            };
        } else if (syncRole === 'executor') {
            const existingManaged = readManagedSyncConfig(selectedNode.config);
            parsedConfig = {
                ...parsedRuntimeConfig,
                ...existingManaged,
            };
            const managedBy = getManagedByNodeId(selectedNode.config);
            if (managedBy) {
                parsedConfig[SYNC_MANAGED_BY_KEY] = managedBy;
            }
        }

        patchNode(selectedNode.node_id, {
            title: nextTitle,
            config: parsedConfig,
        });
        setConfigDraft(buildRuntimeConfigDraft(parsedConfig, syncRole));
        setSyncFieldDraft(buildSyncFieldDraft(parsedConfig));
        setErrorMessage(null);
        setSuccessMessage(t('nodeConfig.success.saved'));
    };

    const onReset = (): void => {
        setTitleDraft(selectedNode.title);
        setConfigDraft(buildRuntimeConfigDraft(selectedNode.config, syncRole));
        setSyncFieldDraft(buildSyncFieldDraft(selectedNode.config));
        setErrorMessage(null);
        setSuccessMessage(null);
    };

    return (
        <section style={panelStyle} data-testid="node-config-panel">
            <h3 style={{marginTop: 0, marginBottom: 6}}>{t('nodeConfig.title')}</h3>
            <div style={{fontSize: 12, opacity: 0.78, marginBottom: 8}}>
                <div>{t('nodeConfig.meta.nodeId', {nodeId: selectedNode.node_id})}</div>
                <div>{t('nodeConfig.meta.typeName', {typeName: selectedNode.type_name})}</div>
            </div>

            <label style={{fontSize: 12}}>
                {t('nodeConfig.fields.title')}
                <input
                    value={titleDraft}
                    onChange={(event) => {
                        setTitleDraft(event.target.value);
                        setSuccessMessage(null);
                    }}
                    style={inputStyle}
                    data-testid="node-config-title-input"
                />
            </label>

            <label style={{display: 'block', fontSize: 12, marginTop: 10}}>
                {isSyncNode ? t('nodeConfig.fields.runtimeConfigJson') : t('nodeConfig.fields.configJson')}
                <textarea
                    value={configDraft}
                    onChange={(event) => {
                        setConfigDraft(event.target.value);
                        setSuccessMessage(null);
                    }}
                    style={textareaStyle}
                    data-testid="node-config-json-input"
                />
            </label>

            {isSyncNode && (
                <section
                    style={{
                        marginTop: 10,
                        border: '1px solid rgba(31, 41, 51, 0.14)',
                        borderRadius: 8,
                        padding: 8,
                        background: '#ffffff',
                    }}
                    data-testid="node-config-sync-fields"
                >
                    <div style={{fontSize: 12, fontWeight: 600, marginBottom: 6}}>
                        {t('nodeConfig.sync.title')}
                    </div>
                    <div style={{fontSize: 12, color: '#475569', marginBottom: 8}}>
                        {syncRole === 'initiator'
                            ? t('nodeConfig.sync.hints.initiatorManaged')
                            : t('nodeConfig.sync.hints.executorReadonly')}
                    </div>
                    {syncRole === 'executor' && managedByNodeId && (
                        <div style={{fontSize: 12, color: '#334155', marginBottom: 8}} data-testid="node-config-sync-managed-by">
                            {t('nodeConfig.sync.hints.managedBy', {nodeId: managedByNodeId})}
                        </div>
                    )}
                    <label style={{display: 'block', fontSize: 12, marginBottom: 8}}>
                        {t('nodeConfig.sync.fields.syncGroup')}
                        <input
                            value={syncFieldDraft.syncGroup}
                            onChange={(event) => {
                                setSyncFieldDraft((current) => ({
                                    ...current,
                                    syncGroup: event.target.value,
                                }));
                                setSuccessMessage(null);
                            }}
                            disabled={syncRole !== 'initiator'}
                            style={inputStyle}
                            data-testid="node-config-sync-group-input"
                        />
                    </label>
                    <label style={{display: 'block', fontSize: 12, marginBottom: 8}}>
                        {t('nodeConfig.sync.fields.syncRound')}
                        <input
                            value={syncFieldDraft.syncRound}
                            disabled
                            style={inputStyle}
                            data-testid="node-config-sync-round-input"
                        />
                        <div style={{fontSize: 11, color: '#64748b', marginTop: 4}}>
                            {t('nodeConfig.sync.hints.syncRoundAuto')}
                        </div>
                    </label>
                    <label style={{display: 'block', fontSize: 12, marginBottom: 8}}>
                        {t('nodeConfig.sync.fields.readyTimeoutMs')}
                        <input
                            value={syncFieldDraft.readyTimeoutMs}
                            onChange={(event) => {
                                setSyncFieldDraft((current) => ({
                                    ...current,
                                    readyTimeoutMs: event.target.value,
                                }));
                                setSuccessMessage(null);
                            }}
                            disabled={syncRole !== 'initiator'}
                            style={inputStyle}
                            data-testid="node-config-ready-timeout-input"
                        />
                    </label>
                    <label style={{display: 'block', fontSize: 12}}>
                        {t('nodeConfig.sync.fields.commitLeadMs')}
                        <input
                            value={syncFieldDraft.commitLeadMs}
                            onChange={(event) => {
                                setSyncFieldDraft((current) => ({
                                    ...current,
                                    commitLeadMs: event.target.value,
                                }));
                                setSuccessMessage(null);
                            }}
                            disabled={syncRole !== 'initiator'}
                            style={inputStyle}
                            data-testid="node-config-commit-lead-input"
                        />
                    </label>
                </section>
            )}

            <div style={{marginTop: 10}}>
                <button type="button" style={buttonStyle} onClick={onSave}>
                    {t('nodeConfig.actions.save')}
                </button>
                <button type="button" style={buttonStyle} onClick={onReset}>
                    {t('nodeConfig.actions.reset')}
                </button>
            </div>

            {errorMessage && (
                <p style={{color: '#9f1239', fontSize: 12, marginBottom: 0}} data-testid="node-config-error">
                    {errorMessage}
                </p>
            )}
            {successMessage && !errorMessage && (
                <p style={{color: '#166534', fontSize: 12, marginBottom: 0}} data-testid="node-config-success">
                    {successMessage}
                </p>
            )}
        </section>
    );
}
