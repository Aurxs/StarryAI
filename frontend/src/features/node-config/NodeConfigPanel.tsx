import {useEffect, useMemo, useState, type CSSProperties} from 'react';
import {useTranslation} from 'react-i18next';

import type {NodeSpec} from '../../entities/workbench/types';
import {apiClient, ApiClientError} from '../../shared/api/client';
import {SchemaForm} from '../../shared/schema-form/SchemaForm';
import {findPlaintextSecretPaths} from '../../shared/schema-form/normalize-schema';
import {useGraphStore} from '../../shared/state/graph-store';
import {useSecretStore} from '../../shared/state/secret-store';
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
    display: 'grid',
    gap: 12,
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
    minHeight: 140,
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

const sectionTitleStyle: CSSProperties = {
    fontSize: 12,
    fontWeight: 600,
    color: '#334155',
};

const readonlyValueStyle: CSSProperties = {
    fontSize: 13,
    color: '#0f172a',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    minHeight: 20,
    marginTop: 6,
};

const advancedSectionStyle: CSSProperties = {
    display: 'grid',
    gap: 8,
    paddingTop: 12,
    borderTop: '1px solid rgba(148, 163, 184, 0.28)',
};

const formatJson = (value: Record<string, unknown>): string => JSON.stringify(value, null, 2);

const parseInteger = (value: string): number | null => {
    const trimmed = value.trim();
    if (!trimmed || !/^-?\d+$/.test(trimmed)) {
        return null;
    }
    return Number.parseInt(trimmed, 10);
};

const formatReadonlyValue = (value: string): string => {
    if (!value.trim()) {
        return '-';
    }
    return value;
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

const buildRuntimeConfig = (config: Record<string, unknown>, role: SyncPanelRole): Record<string, unknown> =>
    role === 'none' ? config : stripManagedSyncFields(config);

const parseRuntimeConfigText = (
    text: string,
    t: (key: string) => string,
): Record<string, unknown> => {
    let rawParsed: unknown;
    try {
        rawParsed = JSON.parse(text) as unknown;
    } catch {
        throw new Error(t('nodeConfig.errors.invalidJson'));
    }
    if (!rawParsed || typeof rawParsed !== 'object' || Array.isArray(rawParsed)) {
        throw new Error(t('nodeConfig.errors.mustBeObject'));
    }
    return rawParsed as Record<string, unknown>;
};

const assertNoPlaintextSecrets = (
    config: Record<string, unknown>,
    configSchema: Record<string, unknown>,
    t: (key: string, options?: Record<string, unknown>) => string,
): void => {
    const secretPaths = findPlaintextSecretPaths(configSchema, config);
    if (secretPaths.length > 0) {
        throw new Error(
            t('nodeConfig.errors.secretPlaintextForbidden', {
                paths: secretPaths.join(', '),
            }),
        );
    }
};

export function NodeConfigPanel() {
    const {t} = useTranslation();
    const selectedNodeId = useGraphStore((state) => state.selectedNodeId);
    const nodes = useGraphStore((state) => state.graph.nodes);
    const patchNode = useGraphStore((state) => state.patchNode);

    const secrets = useSecretStore((state) => state.items);
    const loadSecrets = useSecretStore((state) => state.loadSecrets);
    const createSecret = useSecretStore((state) => state.createSecret);

    const [catalogByType, setCatalogByType] = useState<Map<string, NodeSpec>>(new Map());
    const [titleDraft, setTitleDraft] = useState('');
    const [runtimeConfigDraft, setRuntimeConfigDraft] = useState<Record<string, unknown>>({});
    const [configDraftText, setConfigDraftText] = useState('{}');
    const [syncFieldDraft, setSyncFieldDraft] = useState<SyncFieldDraft>(createDefaultSyncFieldDraft());
    const [showAdvancedJson, setShowAdvancedJson] = useState(false);
    const [jsonDraftError, setJsonDraftError] = useState<string | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

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
    const runtimeSchema = selectedSpec?.config_schema ?? {type: 'object', properties: {}};

    useEffect(() => {
        let cancelled = false;
        const loadCatalog = async () => {
            try {
                const [catalogPayload] = await Promise.all([
                    apiClient.listNodeTypes(),
                    loadSecrets().catch(() => undefined),
                ]);
                if (cancelled) {
                    return;
                }
                const next = new Map<string, NodeSpec>();
                for (const item of catalogPayload.items) {
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
    }, [loadSecrets]);

    useEffect(() => {
        if (!selectedNode) {
            setTitleDraft('');
            setRuntimeConfigDraft({});
            setConfigDraftText('{}');
            setSyncFieldDraft(createDefaultSyncFieldDraft());
            setShowAdvancedJson(false);
            setJsonDraftError(null);
            setErrorMessage(null);
            setSuccessMessage(null);
            return;
        }
        const runtimeConfig = buildRuntimeConfig(selectedNode.config, syncRole);
        setTitleDraft(selectedNode.title);
        setRuntimeConfigDraft(runtimeConfig);
        setConfigDraftText(formatJson(runtimeConfig));
        setSyncFieldDraft(buildSyncFieldDraft(selectedNode.config));
        setJsonDraftError(null);
        setErrorMessage(null);
        setSuccessMessage(null);
    }, [selectedNode, syncRole]);

    if (!selectedNode) {
        return (
            <section style={panelStyle} data-testid="node-config-empty">
                <h3 style={{margin: 0}}>{t('nodeConfig.title')}</h3>
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
            parsedRuntimeConfig = parseRuntimeConfigText(configDraftText, t);
            assertNoPlaintextSecrets(parsedRuntimeConfig, runtimeSchema, t);
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : String(error));
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
        setRuntimeConfigDraft(parsedRuntimeConfig);
        setConfigDraftText(formatJson(parsedRuntimeConfig));
        setSyncFieldDraft(buildSyncFieldDraft(parsedConfig));
        setJsonDraftError(null);
        setErrorMessage(null);
        setSuccessMessage(t('nodeConfig.success.saved'));
    };

    const onReset = (): void => {
        setTitleDraft(selectedNode.title);
        const nextRuntimeConfig = buildRuntimeConfig(selectedNode.config, syncRole);
        setRuntimeConfigDraft(nextRuntimeConfig);
        setConfigDraftText(formatJson(nextRuntimeConfig));
        setSyncFieldDraft(buildSyncFieldDraft(selectedNode.config));
        setJsonDraftError(null);
        setErrorMessage(null);
        setSuccessMessage(null);
    };

    const renderSyncField = ({
        label,
        value,
        testId,
        onChange,
        readonly,
        helperText,
    }: {
        label: string;
        value: string;
        testId: string;
        onChange?: (nextValue: string) => void;
        readonly: boolean;
        helperText?: string;
    }) => (
        <label style={{display: 'block', fontSize: 12}}>
            {label}
            {readonly ? (
                <div style={readonlyValueStyle} data-testid={testId}>
                    {formatReadonlyValue(value)}
                </div>
            ) : (
                <input
                    value={value}
                    onChange={(event) => {
                        onChange?.(event.target.value);
                        setSuccessMessage(null);
                    }}
                    style={inputStyle}
                    data-testid={testId}
                />
            )}
            {helperText && (
                <div style={{fontSize: 11, color: '#64748b', marginTop: 4}}>
                    {helperText}
                </div>
            )}
        </label>
    );

    return (
        <section style={panelStyle} data-testid="node-config-panel">
            <h3 style={{margin: 0}}>{t('nodeConfig.title')}</h3>
            <div style={{fontSize: 12, opacity: 0.78, display: 'grid', gap: 2}}>
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

            <SchemaForm
                nodeTypeName={selectedNode.type_name}
                schema={runtimeSchema}
                value={runtimeConfigDraft}
                secrets={secrets}
                onCreateSecret={async (request) => {
                    try {
                        const created = await createSecret(request);
                        return created;
                    } catch (error) {
                        throw new ApiClientError(
                            error instanceof Error ? error.message : String(error),
                            'validation',
                            null,
                            null,
                        );
                    }
                }}
                onChange={(nextConfig) => {
                    setRuntimeConfigDraft(nextConfig);
                    setConfigDraftText(formatJson(nextConfig));
                    setJsonDraftError(null);
                    setErrorMessage(null);
                    setSuccessMessage(null);
                }}
            />

            <section style={advancedSectionStyle} data-testid="node-config-advanced-json">
                <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8}}>
                    <div style={sectionTitleStyle}>{t('nodeConfig.fields.advancedJson')}</div>
                    <button
                        type="button"
                        style={buttonStyle}
                        onClick={() => setShowAdvancedJson((current) => !current)}
                    >
                        {showAdvancedJson ? t('nodeConfig.actions.hideAdvanced') : t('nodeConfig.actions.showAdvanced')}
                    </button>
                </div>
                <div style={{display: showAdvancedJson ? 'block' : 'none'}}>
                    <label style={{display: 'block', fontSize: 12}}>
                        {isSyncNode ? t('nodeConfig.fields.runtimeConfigJson') : t('nodeConfig.fields.configJson')}
                        <textarea
                            value={configDraftText}
                            onChange={(event) => {
                                const nextText = event.target.value;
                                setConfigDraftText(nextText);
                                setErrorMessage(null);
                                setSuccessMessage(null);
                                try {
                                    const nextRuntimeConfig = parseRuntimeConfigText(nextText, t);
                                    assertNoPlaintextSecrets(nextRuntimeConfig, runtimeSchema, t);
                                    setRuntimeConfigDraft(nextRuntimeConfig);
                                    setJsonDraftError(null);
                                } catch (error) {
                                    setJsonDraftError(error instanceof Error ? error.message : String(error));
                                }
                            }}
                            style={textareaStyle}
                            data-testid="node-config-json-input"
                        />
                        {jsonDraftError && (
                            <div style={{fontSize: 11, color: '#9f1239', marginTop: 4}}>{jsonDraftError}</div>
                        )}
                    </label>
                </div>
            </section>

            {isSyncNode && (
                <section
                    style={{
                        ...advancedSectionStyle,
                        marginTop: 10,
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
                    <div style={{display: 'grid', gap: 8}}>
                        {renderSyncField({
                            label: t('nodeConfig.sync.fields.syncGroup'),
                            value: syncFieldDraft.syncGroup,
                            testId: 'node-config-sync-group-input',
                            readonly: syncRole !== 'initiator',
                            onChange: (nextValue) => {
                                setSyncFieldDraft((current) => ({
                                    ...current,
                                    syncGroup: nextValue,
                                }));
                            },
                        })}
                        {renderSyncField({
                            label: t('nodeConfig.sync.fields.syncRound'),
                            value: syncFieldDraft.syncRound,
                            testId: 'node-config-sync-round-input',
                            readonly: true,
                            helperText: t('nodeConfig.sync.hints.syncRoundAuto'),
                        })}
                        {renderSyncField({
                            label: t('nodeConfig.sync.fields.readyTimeoutMs'),
                            value: syncFieldDraft.readyTimeoutMs,
                            testId: 'node-config-ready-timeout-input',
                            readonly: syncRole !== 'initiator',
                            onChange: (nextValue) => {
                                setSyncFieldDraft((current) => ({
                                    ...current,
                                    readyTimeoutMs: nextValue,
                                }));
                            },
                        })}
                        {renderSyncField({
                            label: t('nodeConfig.sync.fields.commitLeadMs'),
                            value: syncFieldDraft.commitLeadMs,
                            testId: 'node-config-commit-lead-input',
                            readonly: syncRole !== 'initiator',
                            onChange: (nextValue) => {
                                setSyncFieldDraft((current) => ({
                                    ...current,
                                    commitLeadMs: nextValue,
                                }));
                            },
                        })}
                    </div>
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
