import {useEffect, useMemo, useState, type CSSProperties} from 'react';
import {useTranslation} from 'react-i18next';

import type {NodeSpec} from '../../entities/workbench/types';
import {apiClient, ApiClientError} from '../../shared/api/client';
import {
    GRAPH_VARIABLE_VALUE_KINDS,
    findGraphVariable,
    isDuplicateGraphVariableName,
    isDataWriterType,
    isGenericDataNodeType,
    readDataRegistry,
} from '../../shared/data-registry';
import {
    createDefaultVariableDraft,
    formatVariableInitialValue,
    parseVariableInitialValue,
    type GraphVariableDraft,
} from '../../shared/graph-variables';
import {translateValueKind} from '../../shared/i18n/label-mappers';
import {SchemaForm} from '../../shared/schema-form/SchemaForm';
import {applySchemaDefaults, findPlaintextSecretPaths} from '../../shared/schema-form/normalize-schema';
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
    height: 30,
    padding: '4px 10px',
    lineHeight: '18px',
    fontSize: 13,
    marginTop: 4,
    color: '#0f172a',
    background: '#ffffff',
};

const invalidInputStyle: CSSProperties = {
    ...inputStyle,
    border: '1px solid #dc2626',
    boxShadow: '0 0 0 1px rgba(220, 38, 38, 0.12)',
};

const textareaStyle: CSSProperties = {
    ...inputStyle,
    height: 'auto',
    minHeight: 140,
    resize: 'vertical',
    fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
    lineHeight: 1.4,
};

const labelStyle: CSSProperties = {
    display: 'grid',
    gap: 4,
    fontSize: 12,
    color: '#334155',
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

const cloneRecord = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const isDataNodeType = (typeName: string): boolean =>
    isGenericDataNodeType(typeName) || isDataWriterType(typeName);

type SyncPanelRole = 'none' | 'initiator' | 'executor';

interface SyncFieldDraft {
    syncGroup: string;
    syncRound: string;
    readyTimeoutMs: string;
    commitLeadMs: string;
}

interface NodeConfigSnapshot {
    nodeId: string;
    schemaSignature: string;
    syncRole: SyncPanelRole;
    title: string;
    rawConfig: Record<string, unknown>;
    runtimeConfig: Record<string, unknown>;
    syncFieldDraft: SyncFieldDraft;
    dataWriterLiteralDraft: string;
    metadata: Record<string, unknown>;
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

const buildEffectiveRuntimeConfig = (
    config: Record<string, unknown>,
    role: SyncPanelRole,
    schema: Record<string, unknown>,
): Record<string, unknown> => applySchemaDefaults(schema, buildRuntimeConfig(config, role));

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
    const graphMetadata = useGraphStore((state) => state.graph.metadata);
    const patchNode = useGraphStore((state) => state.patchNode);
    const createVariable = useGraphStore((state) => state.createVariable);
    const setMetadata = useGraphStore((state) => state.setMetadata);

    const secrets = useSecretStore((state) => state.items);
    const loadSecrets = useSecretStore((state) => state.loadSecrets);
    const createSecret = useSecretStore((state) => state.createSecret);

    const [catalogByType, setCatalogByType] = useState<Map<string, NodeSpec>>(new Map());
    const [titleDraft, setTitleDraft] = useState('');
    const [runtimeConfigDraft, setRuntimeConfigDraft] = useState<Record<string, unknown>>({});
    const [configDraftText, setConfigDraftText] = useState('{}');
    const [syncFieldDraft, setSyncFieldDraft] = useState<SyncFieldDraft>(createDefaultSyncFieldDraft());
    const [dataWriterLiteralDraft, setDataWriterLiteralDraft] = useState('0');
    const [showCreateVariable, setShowCreateVariable] = useState(false);
    const [variableDraft, setVariableDraft] = useState<GraphVariableDraft>(createDefaultVariableDraft());
    const [showAdvancedJson, setShowAdvancedJson] = useState(false);
    const [jsonDraftError, setJsonDraftError] = useState<string | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [initialSnapshot, setInitialSnapshot] = useState<NodeConfigSnapshot | null>(null);

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
    const runtimeSchema = useMemo<Record<string, unknown>>(
        () => selectedSpec?.config_schema ?? {type: 'object', properties: {}},
        [selectedSpec],
    );
    const runtimeSchemaSignature = useMemo(() => JSON.stringify(runtimeSchema), [runtimeSchema]);
    const isDataNode = selectedNode ? isDataNodeType(selectedNode.type_name) : false;
    const isDataRef = selectedNode ? isGenericDataNodeType(selectedNode.type_name) : false;
    const isDataWriter = selectedNode ? isDataWriterType(selectedNode.type_name) : false;
    const graphVariables = useMemo(() => readDataRegistry(graphMetadata).variables, [graphMetadata]);
    const duplicateVariableName = useMemo(
        () => {
            const trimmedName = variableDraft.name.trim();
            return trimmedName ? isDuplicateGraphVariableName(graphMetadata, trimmedName) : false;
        },
        [graphMetadata, variableDraft.name],
    );
    const variableParseMessages = useMemo(
        () => ({
            invalidIntegerInitialValue: t('graphVariable.errors.invalidIntegerInitialValue'),
            invalidFloatInitialValue: t('graphVariable.errors.invalidFloatInitialValue'),
            invalidJsonInitialValue: t('graphVariable.errors.invalidJsonInitialValue'),
            listInitialValueMustBeArray: t('graphVariable.errors.listInitialValueMustBeArray'),
            dictInitialValueMustBeObject: t('graphVariable.errors.dictInitialValueMustBeObject'),
        }),
        [t],
    );

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
            setInitialSnapshot(null);
            setTitleDraft('');
            setRuntimeConfigDraft({});
            setConfigDraftText('{}');
            setSyncFieldDraft(createDefaultSyncFieldDraft());
            setDataWriterLiteralDraft('0');
            setShowCreateVariable(false);
            setVariableDraft(createDefaultVariableDraft());
            setShowAdvancedJson(false);
            setJsonDraftError(null);
            setErrorMessage(null);
            return;
        }
        if (
            initialSnapshot?.nodeId === selectedNode.node_id
            && initialSnapshot.schemaSignature === runtimeSchemaSignature
            && initialSnapshot.syncRole === syncRole
        ) {
            return;
        }
        const runtimeConfig = buildEffectiveRuntimeConfig(selectedNode.config, syncRole, runtimeSchema);
        const nextSyncFieldDraft = buildSyncFieldDraft(selectedNode.config);
        const literalValue = runtimeConfig.literal_value;
        const nextLiteralDraft = literalValue === undefined || literalValue === null ? '' : String(literalValue);
        const selectedVariable = findGraphVariable(
            graphMetadata,
            typeof runtimeConfig.variable_name === 'string' ? runtimeConfig.variable_name : null,
        );
        const formattedInitial = formatVariableInitialValue(selectedVariable);
        setInitialSnapshot({
            nodeId: selectedNode.node_id,
            schemaSignature: runtimeSchemaSignature,
            syncRole,
            title: selectedNode.title,
            rawConfig: cloneRecord(selectedNode.config),
            runtimeConfig: cloneRecord(runtimeConfig),
            syncFieldDraft: cloneRecord(nextSyncFieldDraft),
            dataWriterLiteralDraft: nextLiteralDraft,
            metadata: cloneRecord(graphMetadata),
        });
        setTitleDraft(selectedNode.title);
        setRuntimeConfigDraft(runtimeConfig);
        setConfigDraftText(formatJson(runtimeConfig));
        setSyncFieldDraft(nextSyncFieldDraft);
        setDataWriterLiteralDraft(nextLiteralDraft);
        setShowCreateVariable(false);
        setVariableDraft({
            name: '',
            valueKind: selectedVariable?.value_kind ?? 'scalar.int',
            scalarInitialValue: formattedInitial.scalar || '0',
            jsonInitialValue: formattedInitial.json,
        });
        setJsonDraftError(null);
        setErrorMessage(null);
    }, [graphMetadata, initialSnapshot, runtimeSchema, runtimeSchemaSignature, selectedNode, syncRole]);

    if (!selectedNode) {
        return (
            <section style={panelStyle} data-testid="node-config-empty">
                <p style={{fontSize: 13, opacity: 0.82, marginBottom: 0}}>
                    {t('nodeConfig.emptyPrompt')}
                </p>
            </section>
        );
    }

    const buildConfigWithPersistedSync = (
        runtimeConfig: Record<string, unknown>,
        nodeConfig: Record<string, unknown>,
    ): Record<string, unknown> => {
        if (syncRole === 'initiator') {
            const existingManaged = readManagedSyncConfig(nodeConfig);
            return {
                ...runtimeConfig,
                [SYNC_GROUP_KEY]: existingManaged.sync_group,
                [SYNC_ROUND_KEY]: existingManaged.sync_round,
                [READY_TIMEOUT_KEY]: existingManaged.ready_timeout_ms,
                [COMMIT_LEAD_KEY]: existingManaged.commit_lead_ms,
                [SYNC_ROUND_AUTO_KEY]: true,
            };
        }
        if (syncRole === 'executor') {
            const existingManaged = readManagedSyncConfig(nodeConfig);
            const nextConfig: Record<string, unknown> = {
                ...runtimeConfig,
                ...existingManaged,
            };
            const managedBy = getManagedByNodeId(nodeConfig);
            if (managedBy) {
                nextConfig[SYNC_MANAGED_BY_KEY] = managedBy;
            }
            return nextConfig;
        }
        return runtimeConfig;
    };

    const buildConfigWithSyncDraft = (
        runtimeConfig: Record<string, unknown>,
        nextSyncFieldDraft: SyncFieldDraft,
        nodeConfig: Record<string, unknown>,
    ): Record<string, unknown> => {
        const syncGroup = nextSyncFieldDraft.syncGroup.trim();
        if (!syncGroup) {
            throw new Error(t('nodeConfig.errors.syncGroupRequired'));
        }
        const readyTimeoutMs = parseInteger(nextSyncFieldDraft.readyTimeoutMs);
        if (readyTimeoutMs === null || readyTimeoutMs < 1) {
            throw new Error(t('nodeConfig.errors.readyTimeoutInvalid'));
        }
        const commitLeadMs = parseInteger(nextSyncFieldDraft.commitLeadMs);
        if (commitLeadMs === null || commitLeadMs < 1) {
            throw new Error(t('nodeConfig.errors.commitLeadInvalid'));
        }
        const existingManaged = readManagedSyncConfig(nodeConfig);
        return {
            ...runtimeConfig,
            [SYNC_GROUP_KEY]: syncGroup,
            [SYNC_ROUND_KEY]: existingManaged.sync_round,
            [READY_TIMEOUT_KEY]: readyTimeoutMs,
            [COMMIT_LEAD_KEY]: commitLeadMs,
            [SYNC_ROUND_AUTO_KEY]: true,
        };
    };

    const commitRuntimeConfigChange = (nextRuntimeConfig: Record<string, unknown>): void => {
        const nextConfig = buildConfigWithPersistedSync(nextRuntimeConfig, selectedNode.config);
        patchNode(selectedNode.node_id, {config: nextConfig});
        setRuntimeConfigDraft(nextRuntimeConfig);
        setConfigDraftText(formatJson(nextRuntimeConfig));
        const literalValue = nextRuntimeConfig.literal_value;
        setDataWriterLiteralDraft(
            literalValue === undefined || literalValue === null ? '' : String(literalValue),
        );
        setJsonDraftError(null);
        setErrorMessage(null);
    };

    const commitTitleChange = (nextTitleDraft: string): void => {
        setTitleDraft(nextTitleDraft);
        patchNode(selectedNode.node_id, {
            title: nextTitleDraft.trim() || selectedNode.type_name,
        });
        setErrorMessage(null);
    };

    const commitCreateVariable = (): void => {
        try {
            const name = variableDraft.name.trim();
            if (!name) {
                throw new Error(t('graphVariable.errors.emptyName'));
            }
            if (isDuplicateGraphVariableName(graphMetadata, name)) {
                throw new Error(
                    t('graphVariable.errors.duplicateName', {
                        name,
                    }),
                );
            }
            const initialValue = parseVariableInitialValue(
                variableDraft.valueKind,
                variableDraft.scalarInitialValue,
                variableDraft.jsonInitialValue,
                variableParseMessages,
            );
            const created = createVariable({
                name,
                value_kind: variableDraft.valueKind,
                initial_value: initialValue,
            });
            if (!created) {
                throw new Error(
                    t('graphVariable.errors.duplicateName', {
                        name,
                    }),
                );
            }
            commitRuntimeConfigChange({
                ...runtimeConfigDraft,
                variable_name: name,
            });
            setShowCreateVariable(false);
            setVariableDraft(createDefaultVariableDraft());
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : String(error));
        }
    };

    const onReset = (): void => {
        if (!initialSnapshot) {
            return;
        }
        setTitleDraft(initialSnapshot.title);
        const nextRuntimeConfig = cloneRecord(initialSnapshot.runtimeConfig);
        setRuntimeConfigDraft(nextRuntimeConfig);
        setConfigDraftText(formatJson(nextRuntimeConfig));
        setSyncFieldDraft(cloneRecord(initialSnapshot.syncFieldDraft));
        setDataWriterLiteralDraft(initialSnapshot.dataWriterLiteralDraft);
        setShowCreateVariable(false);
        const selectedVariable = findGraphVariable(
            initialSnapshot.metadata,
            typeof nextRuntimeConfig.variable_name === 'string' ? nextRuntimeConfig.variable_name : null,
        );
        const formattedInitial = formatVariableInitialValue(selectedVariable);
        setVariableDraft({
            name: '',
            valueKind: selectedVariable?.value_kind ?? 'scalar.int',
            scalarInitialValue: formattedInitial.scalar || '0',
            jsonInitialValue: formattedInitial.json,
        });
        setJsonDraftError(null);
        setErrorMessage(null);
        setMetadata(cloneRecord(initialSnapshot.metadata));
        patchNode(selectedNode.node_id, {
            title: initialSnapshot.title,
            config: cloneRecord(initialSnapshot.rawConfig),
        });
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
                    }}
                    style={inputStyle}
                    className="node-config-control"
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

    const selectedDataRefVariable = isDataRef
        ? findGraphVariable(
            graphMetadata,
            typeof runtimeConfigDraft.variable_name === 'string' ? runtimeConfigDraft.variable_name : null,
        )
        : null;
    const selectedWriterTargetVariable = isDataWriter
        ? findGraphVariable(
            graphMetadata,
            typeof runtimeConfigDraft.target_variable_name === 'string' ? runtimeConfigDraft.target_variable_name : null,
        )
        : null;
    const selectedWriterScalarKind = selectedWriterTargetVariable?.value_kind ?? null;

    const renderDataControls = (): JSX.Element | null => {
        if (!selectedNode) {
            return null;
        }
        if (isDataRef) {
            const usesJsonEditor = variableDraft.valueKind.startsWith('json.');
            return (
                <section style={{display: 'grid', gap: 10}} data-testid="node-config-data-ref">
                    <label style={labelStyle}>
                        {t('nodeConfig.data.ref.variable', {defaultValue: '绑定变量'})}
                        <select
                            value={typeof runtimeConfigDraft.variable_name === 'string' ? runtimeConfigDraft.variable_name : ''}
                            style={inputStyle}
                            className="node-config-control"
                            onChange={(event) => {
                                commitRuntimeConfigChange({
                                    ...runtimeConfigDraft,
                                    variable_name: event.target.value,
                                });
                            }}
                        >
                            <option value="">{t('nodeConfig.form.emptyValue')}</option>
                            {graphVariables.map((variable) => (
                                <option key={variable.name} value={variable.name}>
                                    {variable.name} ({translateValueKind(t, variable.value_kind)})
                                </option>
                            ))}
                        </select>
                    </label>
                    {selectedDataRefVariable && (
                        <div style={{fontSize: 12, color: '#475569'}} data-testid="node-config-bound-variable-summary">
                            {`${selectedDataRefVariable.name} · ${translateValueKind(t, selectedDataRefVariable.value_kind)}`}
                        </div>
                    )}
                    <div style={{display: 'flex', justifyContent: 'flex-start'}}>
                        <button
                            type="button"
                            style={buttonStyle}
                            onClick={() => setShowCreateVariable((current) => !current)}
                        >
                            {showCreateVariable
                                ? t('nodeConfig.data.ref.hideCreate', {defaultValue: '收起新变量'})
                                : t('nodeConfig.data.ref.showCreate', {defaultValue: '新建变量'})}
                        </button>
                    </div>
                    {showCreateVariable && (
                        <section style={{display: 'grid', gap: 10, padding: 10, border: '1px solid rgba(148, 163, 184, 0.28)', borderRadius: 10}}>
                            <label style={labelStyle}>
                                {t('nodeConfig.data.ref.variableName', {defaultValue: '变量名称'})}
                                <input
                                    value={variableDraft.name}
                                    style={duplicateVariableName ? invalidInputStyle : inputStyle}
                                    className="node-config-control"
                                    onChange={(event) => {
                                        setVariableDraft((current) => ({...current, name: event.target.value}));
                                        setErrorMessage(null);
                                    }}
                                    data-testid="node-config-variable-name-input"
                                />
                                {duplicateVariableName && (
                                    <div style={{fontSize: 11, color: '#dc2626'}}>
                                        {t('nodeConfig.data.ref.duplicateName', {defaultValue: '变量名称重复，请使用唯一名称'})}
                                    </div>
                                )}
                            </label>
                            <label style={labelStyle}>
                                {t('nodeConfig.data.ref.valueKind', {defaultValue: '变量类型'})}
                                <select
                                    value={variableDraft.valueKind}
                                    style={inputStyle}
                                    className="node-config-control"
                                    onChange={(event) => {
                                        const nextValueKind = event.target.value as GraphVariableDraft['valueKind'];
                                        setVariableDraft((current) => ({
                                            ...current,
                                            valueKind: nextValueKind,
                                            scalarInitialValue:
                                                nextValueKind === 'scalar.string' ? '' : current.scalarInitialValue,
                                        }));
                                        setErrorMessage(null);
                                    }}
                                >
                                    {GRAPH_VARIABLE_VALUE_KINDS.map((valueKind) => (
                                        <option key={valueKind} value={valueKind}>
                                            {translateValueKind(t, valueKind)}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            {usesJsonEditor ? (
                                <label style={labelStyle}>
                                    {t('nodeConfig.data.ref.initialValueJson', {defaultValue: '初始值 JSON'})}
                                    <textarea
                                        value={variableDraft.jsonInitialValue}
                                        style={textareaStyle}
                                        className="node-config-control"
                                        onChange={(event) => {
                                            setVariableDraft((current) => ({
                                                ...current,
                                                jsonInitialValue: event.target.value,
                                            }));
                                            setErrorMessage(null);
                                        }}
                                    />
                                </label>
                            ) : (
                                <label style={labelStyle}>
                                    {t('nodeConfig.data.ref.initialValue', {defaultValue: '初始值'})}
                                    <input
                                        value={variableDraft.scalarInitialValue}
                                        style={inputStyle}
                                        className="node-config-control"
                                        onChange={(event) => {
                                            setVariableDraft((current) => ({
                                                ...current,
                                                scalarInitialValue: event.target.value,
                                            }));
                                            setErrorMessage(null);
                                        }}
                                    />
                                </label>
                            )}
                            <div>
                                <button type="button" style={buttonStyle} onClick={commitCreateVariable}>
                                    {t('nodeConfig.data.ref.createAndBind', {defaultValue: '创建并绑定'})}
                                </button>
                            </div>
                        </section>
                    )}
                </section>
            );
        }
        if (isDataWriter) {
            const operation = typeof runtimeConfigDraft.operation === 'string'
                ? runtimeConfigDraft.operation
                : 'set_from_input';
            const operandMode = typeof runtimeConfigDraft.operand_mode === 'string'
                ? runtimeConfigDraft.operand_mode
                : 'literal';
            const isArithmetic = ['add', 'subtract', 'multiply', 'divide'].includes(operation);
            const usesFieldPath = operation === 'set_path_from_input';
            return (
                <section style={{display: 'grid', gap: 10}} data-testid="node-config-data-writer">
                    <label style={labelStyle}>
                        {t('nodeConfig.data.writer.target', {defaultValue: '目标变量'})}
                        <select
                            value={typeof runtimeConfigDraft.target_variable_name === 'string' ? runtimeConfigDraft.target_variable_name : ''}
                            style={inputStyle}
                            className="node-config-control"
                            onChange={(event) => {
                                commitRuntimeConfigChange({
                                    ...runtimeConfigDraft,
                                    target_variable_name: event.target.value,
                                });
                            }}
                        >
                            <option value="">{t('nodeConfig.form.emptyValue')}</option>
                            {graphVariables.map((variable) => (
                                <option key={variable.name} value={variable.name}>
                                    {variable.name} ({translateValueKind(t, variable.value_kind)})
                                </option>
                            ))}
                        </select>
                    </label>
                    <label style={labelStyle}>
                        {t('nodeConfig.data.writer.operation', {defaultValue: '操作'})}
                        <select
                            value={operation}
                            style={inputStyle}
                            className="node-config-control"
                            onChange={(event) => {
                                commitRuntimeConfigChange({
                                    ...runtimeConfigDraft,
                                    operation: event.target.value,
                                });
                            }}
                        >
                            {['add', 'subtract', 'multiply', 'divide', 'set_from_input', 'append_from_input', 'extend_from_input', 'merge_from_input', 'set_path_from_input'].map((item) => (
                                <option key={item} value={item}>
                                    {t(`nodeConfig.data.writer.operations.${item}`, {defaultValue: item})}
                                </option>
                            ))}
                        </select>
                    </label>
                    {isArithmetic && (
                        <>
                            <label style={labelStyle}>
                                {t('nodeConfig.data.writer.operandMode', {defaultValue: '操作数来源'})}
                                <select
                                    value={operandMode}
                                    style={inputStyle}
                                    className="node-config-control"
                                    onChange={(event) => {
                                        commitRuntimeConfigChange({
                                            ...runtimeConfigDraft,
                                            operand_mode: event.target.value,
                                        });
                                    }}
                                >
                                    <option value="literal">
                                        {t('nodeConfig.data.writer.operandModes.literal', {defaultValue: 'literal'})}
                                    </option>
                                    <option value="variable">
                                        {t('nodeConfig.data.writer.operandModes.variable', {defaultValue: 'variable'})}
                                    </option>
                                </select>
                            </label>
                            {operandMode === 'variable' ? (
                                <label style={labelStyle}>
                                    {t('nodeConfig.data.writer.operandVariable', {defaultValue: '操作数变量'})}
                                    <select
                                        value={typeof runtimeConfigDraft.operand_variable_name === 'string' ? runtimeConfigDraft.operand_variable_name : ''}
                                        style={inputStyle}
                                        className="node-config-control"
                                        onChange={(event) => {
                                            commitRuntimeConfigChange({
                                                ...runtimeConfigDraft,
                                                operand_variable_name: event.target.value,
                                            });
                                        }}
                                    >
                                        <option value="">{t('nodeConfig.form.emptyValue')}</option>
                                        {graphVariables
                                            .filter((variable) => variable.value_kind.startsWith('scalar.'))
                                            .map((variable) => (
                                                <option key={variable.name} value={variable.name}>
                                                    {variable.name} ({translateValueKind(t, variable.value_kind)})
                                                </option>
                                            ))}
                                    </select>
                                </label>
                            ) : (
                                <label style={labelStyle}>
                                    {t('nodeConfig.data.writer.literalValue', {defaultValue: '字面量操作数'})}
                                    <input
                                        value={dataWriterLiteralDraft}
                                        style={inputStyle}
                                        className="node-config-control"
                                        onChange={(event) => {
                                            const nextDraft = event.target.value;
                                            setDataWriterLiteralDraft(nextDraft);
                                            let nextValue: unknown = nextDraft;
                                            if (selectedWriterScalarKind === 'scalar.int') {
                                                const parsed = Number.parseInt(nextDraft, 10);
                                                nextValue = Number.isFinite(parsed) ? parsed : nextDraft;
                                            } else if (selectedWriterScalarKind === 'scalar.float') {
                                                const parsed = Number.parseFloat(nextDraft);
                                                nextValue = Number.isFinite(parsed) ? parsed : nextDraft;
                                            }
                                            commitRuntimeConfigChange({
                                                ...runtimeConfigDraft,
                                                literal_value: nextValue,
                                            });
                                        }}
                                    />
                                </label>
                            )}
                        </>
                    )}
                    {usesFieldPath && (
                        <label style={labelStyle}>
                            {t('nodeConfig.data.writer.fieldPath', {defaultValue: '字段路径'})}
                            <input
                                value={typeof runtimeConfigDraft.field_path === 'string' ? runtimeConfigDraft.field_path : ''}
                                style={inputStyle}
                                className="node-config-control"
                                onChange={(event) => {
                                    commitRuntimeConfigChange({
                                        ...runtimeConfigDraft,
                                        field_path: event.target.value,
                                    });
                                }}
                            />
                        </label>
                    )}
                </section>
            );
        }
        return null;
    };

    return (
        <section style={panelStyle} data-testid="node-config-panel">
            <div style={{fontSize: 12, opacity: 0.78, display: 'grid', gap: 2}}>
                <div>{t('nodeConfig.meta.nodeId', {nodeId: selectedNode.node_id})}</div>
                <div>{t('nodeConfig.meta.typeName', {typeName: selectedNode.type_name})}</div>
            </div>

            <label style={{fontSize: 12}}>
                {t('nodeConfig.fields.title')}
                <input
                    value={titleDraft}
                    onChange={(event) => {
                        commitTitleChange(event.target.value);
                    }}
                    style={inputStyle}
                    className="node-config-control"
                    data-testid="node-config-title-input"
                />
            </label>

            {isDataNode ? (
                renderDataControls()
            ) : (
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
                        commitRuntimeConfigChange(nextConfig);
                    }}
                />
            )}

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
                                try {
                                    const nextRuntimeConfig = parseRuntimeConfigText(nextText, t);
                                    assertNoPlaintextSecrets(nextRuntimeConfig, runtimeSchema, t);
                                    patchNode(selectedNode.node_id, {
                                        config: buildConfigWithPersistedSync(nextRuntimeConfig, selectedNode.config),
                                    });
                                    setRuntimeConfigDraft(nextRuntimeConfig);
                                    const literalValue = nextRuntimeConfig.literal_value;
                                    setDataWriterLiteralDraft(
                                        literalValue === undefined || literalValue === null ? '' : String(literalValue),
                                    );
                                    setJsonDraftError(null);
                                } catch (error) {
                                    setJsonDraftError(error instanceof Error ? error.message : String(error));
                                }
                            }}
                            style={textareaStyle}
                            className="node-config-control"
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
                                const nextSyncFieldDraft = {
                                    ...syncFieldDraft,
                                    syncGroup: nextValue,
                                };
                                setSyncFieldDraft(nextSyncFieldDraft);
                                try {
                                    patchNode(selectedNode.node_id, {
                                        config: buildConfigWithSyncDraft(runtimeConfigDraft, nextSyncFieldDraft, selectedNode.config),
                                    });
                                    setErrorMessage(null);
                                } catch (error) {
                                    setErrorMessage(error instanceof Error ? error.message : String(error));
                                }
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
                                const nextSyncFieldDraft = {
                                    ...syncFieldDraft,
                                    readyTimeoutMs: nextValue,
                                };
                                setSyncFieldDraft(nextSyncFieldDraft);
                                try {
                                    patchNode(selectedNode.node_id, {
                                        config: buildConfigWithSyncDraft(runtimeConfigDraft, nextSyncFieldDraft, selectedNode.config),
                                    });
                                    setErrorMessage(null);
                                } catch (error) {
                                    setErrorMessage(error instanceof Error ? error.message : String(error));
                                }
                            },
                        })}
                        {renderSyncField({
                            label: t('nodeConfig.sync.fields.commitLeadMs'),
                            value: syncFieldDraft.commitLeadMs,
                            testId: 'node-config-commit-lead-input',
                            readonly: syncRole !== 'initiator',
                            onChange: (nextValue) => {
                                const nextSyncFieldDraft = {
                                    ...syncFieldDraft,
                                    commitLeadMs: nextValue,
                                };
                                setSyncFieldDraft(nextSyncFieldDraft);
                                try {
                                    patchNode(selectedNode.node_id, {
                                        config: buildConfigWithSyncDraft(runtimeConfigDraft, nextSyncFieldDraft, selectedNode.config),
                                    });
                                    setErrorMessage(null);
                                } catch (error) {
                                    setErrorMessage(error instanceof Error ? error.message : String(error));
                                }
                            },
                        })}
                    </div>
                </section>
            )}

            <div style={{marginTop: 10}}>
                <button type="button" style={buttonStyle} onClick={onReset}>
                    {t('nodeConfig.actions.reset')}
                </button>
            </div>

            {(errorMessage ?? jsonDraftError) && (
                <p style={{color: '#9f1239', fontSize: 12, marginBottom: 0}} data-testid="node-config-error">
                    {errorMessage ?? jsonDraftError}
                </p>
            )}
        </section>
    );
}
