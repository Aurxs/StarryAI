import {useEffect, useMemo, useState, type CSSProperties} from 'react';
import {useTranslation} from 'react-i18next';

import type {GraphVariableSpec, GraphVariableValueKind, NodeSpec} from '../../entities/workbench/types';
import {apiClient, ApiClientError} from '../../shared/api/client';
import {
    GRAPH_VARIABLE_VALUE_KINDS,
    findGraphVariable,
    getValueKindLabel,
    isDuplicateGraphVariableName,
    isDataWriterType,
    isGenericDataNodeType,
    readDataRegistry,
    upsertGraphVariable,
} from '../../shared/data-registry';
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
    padding: '8px 10px',
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
const formatJsonValue = (value: unknown): string => JSON.stringify(value ?? null, null, 2);

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

const isDataNodeType = (typeName: string): boolean =>
    isGenericDataNodeType(typeName) || isDataWriterType(typeName);

const parseJsonValue = (text: string): unknown => JSON.parse(text) as unknown;

const parseFloatValue = (value: string): number | null => {
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }
    const parsed = Number.parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
};

const parseVariableInitialValue = (
    valueKind: GraphVariableValueKind,
    scalarText: string,
    jsonText: string,
): unknown => {
    switch (valueKind) {
        case 'scalar.int': {
            const parsed = parseInteger(scalarText);
            if (parsed === null) {
                throw new Error('integer 初始值非法');
            }
            return parsed;
        }
        case 'scalar.float': {
            const parsed = parseFloatValue(scalarText);
            if (parsed === null) {
                throw new Error('float 初始值非法');
            }
            return parsed;
        }
        case 'scalar.string':
            return scalarText;
        case 'json.list': {
            const parsed = parseJsonValue(jsonText);
            if (!Array.isArray(parsed)) {
                throw new Error('json.list 初始值必须是数组');
            }
            return parsed;
        }
        case 'json.dict': {
            const parsed = parseJsonValue(jsonText);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new Error('json.dict 初始值必须是对象');
            }
            return parsed;
        }
        case 'json.any':
            return parseJsonValue(jsonText);
    }
};

const formatVariableInitialValue = (variable: GraphVariableSpec | null): {scalar: string; json: string} => {
    if (!variable) {
        return {scalar: '', json: 'null'};
    }
    if (variable.value_kind === 'scalar.string') {
        return {scalar: typeof variable.initial_value === 'string' ? variable.initial_value : '', json: '" "'};
    }
    if (variable.value_kind === 'scalar.int' || variable.value_kind === 'scalar.float') {
        return {scalar: variable.initial_value === undefined || variable.initial_value === null ? '' : String(variable.initial_value), json: 'null'};
    }
    return {scalar: '', json: formatJsonValue(variable.initial_value)};
};

interface VariableDraft {
    name: string;
    valueKind: GraphVariableValueKind;
    scalarInitialValue: string;
    jsonInitialValue: string;
}

const createDefaultVariableDraft = (): VariableDraft => ({
    name: '',
    valueKind: 'scalar.int',
    scalarInitialValue: '0',
    jsonInitialValue: 'null',
});

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
    const [variableDraft, setVariableDraft] = useState<VariableDraft>(createDefaultVariableDraft());
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
    const runtimeSchema = useMemo<Record<string, unknown>>(
        () => selectedSpec?.config_schema ?? {type: 'object', properties: {}},
        [selectedSpec],
    );
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
            setDataWriterLiteralDraft('0');
            setShowCreateVariable(false);
            setVariableDraft(createDefaultVariableDraft());
            setShowAdvancedJson(false);
            setJsonDraftError(null);
            setErrorMessage(null);
            setSuccessMessage(null);
            return;
        }
        const runtimeConfig = buildEffectiveRuntimeConfig(selectedNode.config, syncRole, runtimeSchema);
        setTitleDraft(selectedNode.title);
        setRuntimeConfigDraft(runtimeConfig);
        setConfigDraftText(formatJson(runtimeConfig));
        setSyncFieldDraft(buildSyncFieldDraft(selectedNode.config));
        const literalValue = runtimeConfig.literal_value;
        setDataWriterLiteralDraft(
            literalValue === undefined || literalValue === null ? '' : String(literalValue),
        );
        setShowCreateVariable(false);
        const selectedVariable = findGraphVariable(
            graphMetadata,
            typeof runtimeConfig.variable_name === 'string' ? runtimeConfig.variable_name : null,
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
        setSuccessMessage(null);
    }, [graphMetadata, selectedNode, syncRole, selectedSpec, runtimeSchema]);

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
        let nextMetadata = graphMetadata;
        let runtimeConfigForSave = runtimeConfigDraft;
        if (isDataRef && showCreateVariable) {
            try {
                const name = variableDraft.name.trim();
                if (!name) {
                    throw new Error('变量名称不能为空');
                }
                if (isDuplicateGraphVariableName(graphMetadata, name)) {
                    throw new Error(`变量名称已存在: ${name}`);
                }
                const initialValue = parseVariableInitialValue(
                    variableDraft.valueKind,
                    variableDraft.scalarInitialValue,
                    variableDraft.jsonInitialValue,
                );
                nextMetadata = upsertGraphVariable(graphMetadata, {
                    name,
                    value_kind: variableDraft.valueKind,
                    initial_value: initialValue,
                });
                runtimeConfigForSave = {
                    ...runtimeConfigDraft,
                    variable_name: name,
                };
            } catch (error) {
                setErrorMessage(error instanceof Error ? error.message : String(error));
                setSuccessMessage(null);
                return;
            }
        }
        let parsedRuntimeConfig: Record<string, unknown>;
        try {
            parsedRuntimeConfig = parseRuntimeConfigText(configDraftText, t);
            if (runtimeConfigForSave !== runtimeConfigDraft) {
                parsedRuntimeConfig = {
                    ...parsedRuntimeConfig,
                    ...runtimeConfigForSave,
                };
            }
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

        if (nextMetadata !== graphMetadata) {
            setMetadata(nextMetadata);
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
        const nextRuntimeConfig = buildEffectiveRuntimeConfig(selectedNode.config, syncRole, runtimeSchema);
        setRuntimeConfigDraft(nextRuntimeConfig);
        setConfigDraftText(formatJson(nextRuntimeConfig));
        setSyncFieldDraft(buildSyncFieldDraft(selectedNode.config));
        setDataWriterLiteralDraft(
            nextRuntimeConfig.literal_value === undefined || nextRuntimeConfig.literal_value === null
                ? ''
                : String(nextRuntimeConfig.literal_value),
        );
        setShowCreateVariable(false);
        setVariableDraft(createDefaultVariableDraft());
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

    const updateRuntimeConfigDraft = (nextConfig: Record<string, unknown>): void => {
        setRuntimeConfigDraft(nextConfig);
        setConfigDraftText(formatJson(nextConfig));
        setJsonDraftError(null);
        setErrorMessage(null);
        setSuccessMessage(null);
    };

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
                            onChange={(event) => {
                                updateRuntimeConfigDraft({
                                    ...runtimeConfigDraft,
                                    variable_name: event.target.value,
                                });
                            }}
                        >
                            <option value="">{t('nodeConfig.form.emptyValue')}</option>
                            {graphVariables.map((variable) => (
                                <option key={variable.name} value={variable.name}>
                                    {variable.name} ({getValueKindLabel(variable.value_kind)})
                                </option>
                            ))}
                        </select>
                    </label>
                    {selectedDataRefVariable && (
                        <div style={{fontSize: 12, color: '#475569'}} data-testid="node-config-bound-variable-summary">
                            {`${selectedDataRefVariable.name} · ${getValueKindLabel(selectedDataRefVariable.value_kind)}`}
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
                                    onChange={(event) => {
                                        setVariableDraft((current) => ({...current, name: event.target.value}));
                                        setSuccessMessage(null);
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
                                    onChange={(event) => {
                                        const nextValueKind = event.target.value as GraphVariableValueKind;
                                        setVariableDraft((current) => ({
                                            ...current,
                                            valueKind: nextValueKind,
                                            scalarInitialValue:
                                                nextValueKind === 'scalar.string' ? '' : current.scalarInitialValue,
                                        }));
                                        setSuccessMessage(null);
                                    }}
                                >
                                    {GRAPH_VARIABLE_VALUE_KINDS.map((valueKind) => (
                                        <option key={valueKind} value={valueKind}>
                                            {getValueKindLabel(valueKind)}
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
                                        onChange={(event) => {
                                            setVariableDraft((current) => ({
                                                ...current,
                                                jsonInitialValue: event.target.value,
                                            }));
                                            setSuccessMessage(null);
                                        }}
                                    />
                                </label>
                            ) : (
                                <label style={labelStyle}>
                                    {t('nodeConfig.data.ref.initialValue', {defaultValue: '初始值'})}
                                    <input
                                        value={variableDraft.scalarInitialValue}
                                        style={inputStyle}
                                        onChange={(event) => {
                                            setVariableDraft((current) => ({
                                                ...current,
                                                scalarInitialValue: event.target.value,
                                            }));
                                            setSuccessMessage(null);
                                        }}
                                    />
                                </label>
                            )}
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
                            onChange={(event) => {
                                updateRuntimeConfigDraft({
                                    ...runtimeConfigDraft,
                                    target_variable_name: event.target.value,
                                });
                            }}
                        >
                            <option value="">{t('nodeConfig.form.emptyValue')}</option>
                            {graphVariables.map((variable) => (
                                <option key={variable.name} value={variable.name}>
                                    {variable.name} ({getValueKindLabel(variable.value_kind)})
                                </option>
                            ))}
                        </select>
                    </label>
                    <label style={labelStyle}>
                        {t('nodeConfig.data.writer.operation', {defaultValue: '操作'})}
                        <select
                            value={operation}
                            style={inputStyle}
                            onChange={(event) => {
                                updateRuntimeConfigDraft({
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
                                    onChange={(event) => {
                                        updateRuntimeConfigDraft({
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
                                        onChange={(event) => {
                                            updateRuntimeConfigDraft({
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
                                                    {variable.name} ({getValueKindLabel(variable.value_kind)})
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
                                            updateRuntimeConfigDraft({
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
                                onChange={(event) => {
                                    updateRuntimeConfigDraft({
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
                        updateRuntimeConfigDraft(nextConfig);
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
