import {useEffect, useMemo, useState, type CSSProperties} from 'react';
import {X} from 'lucide-react';
import {useTranslation} from 'react-i18next';

import {type GraphVariableSpec} from '../../entities/workbench/types';
import {
    GRAPH_VARIABLE_VALUE_KINDS,
    getValueKindLabel,
    readDataRegistry,
} from '../../shared/data-registry';
import {
    createDefaultVariableDraft,
    formatVariableInitialValue,
    parseVariableInitialValue,
    summarizeVariableInitialValue,
    type GraphVariableDraft,
} from '../../shared/graph-variables';
import {useGraphStore} from '../../shared/state/graph-store';

const drawerStyle: CSSProperties = {
    position: 'absolute',
    left: 56,
    top: 60,
    bottom: 88,
    width: 320,
    zIndex: 11,
    border: '1px solid #dce3ee',
    borderRadius: 14,
    background: 'rgba(255, 255, 255, 0.98)',
    boxShadow: '0 18px 30px rgba(15, 23, 42, 0.1)',
    padding: 10,
    overflow: 'auto',
    display: 'grid',
    alignContent: 'start',
    gap: 12,
};

const closeButtonStyle: CSSProperties = {
    width: 24,
    height: 24,
    border: '1px solid #d5dff0',
    borderRadius: 8,
    background: '#fff',
    color: '#475569',
    cursor: 'pointer',
    padding: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
};

const listButtonStyle: CSSProperties = {
    width: '100%',
    border: '1px solid #dce3ee',
    borderRadius: 10,
    padding: '8px 10px',
    background: '#fff',
    cursor: 'pointer',
    textAlign: 'left',
    display: 'grid',
    gap: 2,
};

const selectedListButtonStyle: CSSProperties = {
    ...listButtonStyle,
    borderColor: '#93c5fd',
    background: '#eff6ff',
};

const buildVariableTypeBadgeStyle = (valueKind: GraphVariableSpec['value_kind']): CSSProperties => {
    const color = valueKind.startsWith('scalar.') ? '#0f766e' : '#c2410c';
    return {
        fontSize: 10,
        borderRadius: 999,
        padding: '1px 6px',
        background: `${color}1A`,
        color,
        border: `1px solid ${color}66`,
        flexShrink: 0,
        lineHeight: 1.4,
    };
};

const variableValueTextStyle: CSSProperties = {
    fontSize: 11,
    color: '#475569',
    flex: '0 1 42%',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    textAlign: 'right',
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
    minHeight: 120,
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
    lineHeight: 1.1,
};

const dangerButtonStyle: CSSProperties = {
    ...buttonStyle,
    borderColor: 'rgba(220, 38, 38, 0.28)',
    color: '#b91c1c',
};

const sectionStyle: CSSProperties = {
    display: 'grid',
    gap: 10,
};

const labelStyle: CSSProperties = {
    display: 'grid',
    gap: 4,
    fontSize: 12,
    color: '#334155',
};

const messageStyle: CSSProperties = {
    fontSize: 12,
    padding: '8px 10px',
    borderRadius: 8,
};

const buildDraftFromVariable = (variable: GraphVariableSpec): GraphVariableDraft => {
    const formatted = formatVariableInitialValue(variable);
    return {
        name: variable.name,
        valueKind: variable.value_kind,
        scalarInitialValue: formatted.scalar || (variable.value_kind === 'scalar.int' ? '0' : ''),
        jsonInitialValue: formatted.json,
    };
};

const getUsageFieldLabel = (fieldName: string): string => {
    switch (fieldName) {
        case 'variable_name':
            return 'variable_name';
        case 'target_variable_name':
            return 'target_variable_name';
        case 'operand_variable_name':
            return 'operand_variable_name';
        default:
            return fieldName;
    }
};

interface VariableManagerDrawerProps {
    open: boolean;
    onClose: () => void;
}

export function VariableManagerDrawer({open, onClose}: VariableManagerDrawerProps) {
    const {t} = useTranslation();
    const graph = useGraphStore((state) => state.graph);
    const selectNode = useGraphStore((state) => state.selectNode);
    const createVariable = useGraphStore((state) => state.createVariable);
    const updateVariable = useGraphStore((state) => state.updateVariable);
    const renameVariable = useGraphStore((state) => state.renameVariable);
    const deleteVariable = useGraphStore((state) => state.deleteVariable);
    const getVariableUsages = useGraphStore((state) => state.getVariableUsages);

    const variables = useMemo(() => readDataRegistry(graph.metadata).variables, [graph.metadata]);
    const [selectedVariableName, setSelectedVariableName] = useState<string | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [draft, setDraft] = useState<GraphVariableDraft>(createDefaultVariableDraft());
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    const selectedVariable = useMemo(
        () => variables.find((variable) => variable.name === selectedVariableName) ?? null,
        [selectedVariableName, variables],
    );
    const selectedUsages = useMemo(
        () => (selectedVariableName ? getVariableUsages(selectedVariableName) : []),
        [getVariableUsages, selectedVariableName],
    );
    const duplicateName = useMemo(() => {
        const normalizedName = draft.name.trim();
        if (!normalizedName) {
            return false;
        }
        return variables.some(
            (variable) =>
                variable.name === normalizedName &&
                (isCreating || normalizedName !== selectedVariableName),
        );
    }, [draft.name, isCreating, selectedVariableName, variables]);

    useEffect(() => {
        if (!open) {
            return;
        }
        if (isCreating) {
            return;
        }
        if (selectedVariableName && selectedVariable) {
            return;
        }
        const firstVariable = variables[0] ?? null;
        if (!firstVariable) {
            setIsCreating(true);
            setSelectedVariableName(null);
            setDraft(createDefaultVariableDraft());
            return;
        }
        setSelectedVariableName(firstVariable.name);
        setDraft(buildDraftFromVariable(firstVariable));
    }, [isCreating, open, selectedVariable, selectedVariableName, variables]);

    if (!open) {
        return null;
    }

    const beginCreate = () => {
        setIsCreating(true);
        setSelectedVariableName(null);
        setDraft(createDefaultVariableDraft());
        setErrorMessage(null);
        setSuccessMessage(null);
    };

    const selectVariableForEdit = (variable: GraphVariableSpec) => {
        setIsCreating(false);
        setSelectedVariableName(variable.name);
        setDraft(buildDraftFromVariable(variable));
        setErrorMessage(null);
        setSuccessMessage(null);
    };

    const handleSave = () => {
        try {
            const normalizedName = draft.name.trim();
            if (!normalizedName) {
                throw new Error(
                    t('variableManager.errors.emptyName', {
                        defaultValue: '变量名称不能为空',
                    }),
                );
            }
            if (duplicateName) {
                throw new Error(
                    t('variableManager.errors.duplicateName', {
                        defaultValue: '变量名称已存在',
                    }),
                );
            }
            const initialValue = parseVariableInitialValue(
                draft.valueKind,
                draft.scalarInitialValue,
                draft.jsonInitialValue,
            );

            if (isCreating || !selectedVariableName) {
                const created = createVariable({
                    name: normalizedName,
                    value_kind: draft.valueKind,
                    initial_value: initialValue,
                });
                if (!created) {
                    throw new Error(
                        t('variableManager.errors.createFailed', {
                            defaultValue: '变量创建失败',
                        }),
                    );
                }
                const nextVariable = {
                    name: normalizedName,
                    value_kind: draft.valueKind,
                    initial_value: initialValue,
                };
                setIsCreating(false);
                setSelectedVariableName(normalizedName);
                setDraft(buildDraftFromVariable(nextVariable));
                setSuccessMessage(
                    t('variableManager.success.created', {
                        defaultValue: '变量已创建',
                    }),
                );
                setErrorMessage(null);
                return;
            }

            let effectiveName = selectedVariableName;
            const needsRename = normalizedName !== selectedVariableName;
            const needsValueUpdate = !selectedVariable
                || selectedVariable.value_kind !== draft.valueKind
                || JSON.stringify(selectedVariable.initial_value) !== JSON.stringify(initialValue);

            if (needsRename) {
                const renamed = renameVariable(selectedVariableName, normalizedName);
                if (!renamed) {
                    throw new Error(
                        t('variableManager.errors.renameFailed', {
                            defaultValue: '变量重命名失败',
                        }),
                    );
                }
                effectiveName = normalizedName;
            }

            if (needsValueUpdate) {
                const updated = updateVariable(effectiveName, {
                    value_kind: draft.valueKind,
                    initial_value: initialValue,
                });
                if (!updated) {
                    throw new Error(
                        t('variableManager.errors.updateFailed', {
                            defaultValue: '变量更新失败',
                        }),
                    );
                }
            }

            const nextVariable = {
                name: effectiveName,
                value_kind: draft.valueKind,
                initial_value: initialValue,
            };
            setSelectedVariableName(effectiveName);
            setDraft(buildDraftFromVariable(nextVariable));
            setSuccessMessage(
                t('variableManager.success.saved', {
                    defaultValue: '变量已保存',
                }),
            );
            setErrorMessage(null);
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : String(error));
            setSuccessMessage(null);
        }
    };

    const handleDelete = () => {
        if (!selectedVariableName) {
            return;
        }
        const usages = getVariableUsages(selectedVariableName);
        if (usages.length > 0) {
            const usageList = usages
                .map((usage) => usage.node_title || usage.node_id)
                .join('、');
            const confirmed = window.confirm(
                t('variableManager.confirm.deleteReferenced', {
                    defaultValue:
                        '变量仍被 {{count}} 个节点引用，删除后这些引用会失效并进入校验错误。继续删除？\n{{usageList}}',
                    count: usages.length,
                    usageList,
                }),
            );
            if (!confirmed) {
                return;
            }
        }
        const deleted = deleteVariable(selectedVariableName);
        if (!deleted) {
            setErrorMessage(
                t('variableManager.errors.deleteFailed', {
                    defaultValue: '变量删除失败',
                }),
            );
            setSuccessMessage(null);
            return;
        }
        const remainingVariables = variables.filter((variable) => variable.name !== selectedVariableName);
        const nextVariable = remainingVariables[0] ?? null;
        if (nextVariable) {
            setSelectedVariableName(nextVariable.name);
            setDraft(buildDraftFromVariable(nextVariable));
            setIsCreating(false);
        } else {
            setSelectedVariableName(null);
            setDraft(createDefaultVariableDraft());
            setIsCreating(true);
        }
        setSuccessMessage(
            t('variableManager.success.deleted', {
                defaultValue: '变量已删除',
            }),
        );
        setErrorMessage(null);
    };

    return (
        <aside aria-label="variable-manager-drawer" style={drawerStyle} data-testid="variable-manager-drawer">
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                <strong>
                    {t('variableManager.title', {
                        defaultValue: '变量管理',
                    })}
                </strong>
                <button
                    type="button"
                    style={closeButtonStyle}
                    aria-label={t('variableManager.actions.close', {defaultValue: '关闭变量管理'})}
                    onClick={onClose}
                >
                    <X size={14} strokeWidth={2.1} aria-hidden="true"/>
                </button>
            </div>

            <section style={sectionStyle}>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                    <strong style={{fontSize: 12, color: '#334155'}}>
                        {t('variableManager.sections.list', {
                            defaultValue: '变量列表',
                        })}
                    </strong>
                    <button
                        type="button"
                        style={buttonStyle}
                        onClick={beginCreate}
                        data-testid="variable-manager-new-button"
                    >
                        {t('variableManager.actions.new', {defaultValue: '新建变量'})}
                    </button>
                </div>
                <div style={{display: 'grid', gap: 8}}>
                    {variables.length === 0 ? (
                        <div style={{fontSize: 12, color: '#64748b'}} data-testid="variable-manager-empty">
                            {t('variableManager.empty', {
                                defaultValue: '当前图还没有变量。',
                            })}
                        </div>
                    ) : (
                        variables.map((variable) => {
                            const usageCount = getVariableUsages(variable.name).length;
                            const selected = !isCreating && variable.name === selectedVariableName;
                            return (
                                <button
                                    key={variable.name}
                                    type="button"
                                    style={selected ? selectedListButtonStyle : listButtonStyle}
                                    onClick={() => selectVariableForEdit(variable)}
                                    data-testid={`variable-manager-item-${variable.name}`}
                                >
                                    <div
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            gap: 12,
                                            minWidth: 0,
                                        }}
                                    >
                                        <div
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 8,
                                                minWidth: 0,
                                                flex: '1 1 auto',
                                            }}
                                        >
                                            <strong
                                                style={{
                                                    fontSize: 13,
                                                    minWidth: 0,
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                }}
                                            >
                                                {variable.name}
                                            </strong>
                                            <span style={buildVariableTypeBadgeStyle(variable.value_kind)}>
                                                {getValueKindLabel(variable.value_kind)}
                                            </span>
                                        </div>
                                        <div
                                            style={variableValueTextStyle}
                                            title={summarizeVariableInitialValue(variable)}
                                        >
                                            {summarizeVariableInitialValue(variable)}
                                        </div>
                                    </div>
                                    <div style={{fontSize: 10, lineHeight: 1.2, color: '#94a3b8'}}>
                                        {t('variableManager.usageCount', {
                                            defaultValue: '引用 {{count}}',
                                            count: usageCount,
                                        })}
                                    </div>
                                </button>
                            );
                        })
                    )}
                </div>
            </section>

            <section style={sectionStyle}>
                <strong style={{fontSize: 12, color: '#334155'}}>
                    {isCreating
                        ? t('variableManager.sections.create', {defaultValue: '新建变量'})
                        : t('variableManager.sections.edit', {defaultValue: '编辑变量'})}
                </strong>
                <label style={labelStyle}>
                    {t('variableManager.fields.name', {defaultValue: '变量名称'})}
                    <input
                        value={draft.name}
                        style={duplicateName ? invalidInputStyle : inputStyle}
                        onChange={(event) => {
                            setDraft((current) => ({...current, name: event.target.value}));
                            setErrorMessage(null);
                            setSuccessMessage(null);
                        }}
                        data-testid="variable-manager-name-input"
                    />
                </label>
                <label style={labelStyle}>
                    {t('variableManager.fields.type', {defaultValue: '变量类型'})}
                    <select
                        value={draft.valueKind}
                        style={inputStyle}
                        onChange={(event) => {
                            const nextValueKind = event.target.value as GraphVariableSpec['value_kind'];
                            setDraft((current) => ({
                                ...current,
                                valueKind: nextValueKind,
                                scalarInitialValue:
                                    nextValueKind === 'scalar.string'
                                        ? current.scalarInitialValue
                                        : nextValueKind === 'scalar.int'
                                            ? current.scalarInitialValue || '0'
                                            : current.scalarInitialValue,
                                jsonInitialValue:
                                    nextValueKind.startsWith('json.')
                                        ? current.jsonInitialValue
                                        : current.jsonInitialValue,
                            }));
                            setErrorMessage(null);
                            setSuccessMessage(null);
                        }}
                        data-testid="variable-manager-type-select"
                    >
                        {GRAPH_VARIABLE_VALUE_KINDS.map((valueKind) => (
                            <option key={valueKind} value={valueKind}>
                                {getValueKindLabel(valueKind)}
                            </option>
                        ))}
                    </select>
                </label>
                {draft.valueKind.startsWith('json.') ? (
                    <label style={labelStyle}>
                        {t('variableManager.fields.initialJson', {defaultValue: '初始值 JSON'})}
                        <textarea
                            value={draft.jsonInitialValue}
                            style={textareaStyle}
                            onChange={(event) => {
                                setDraft((current) => ({
                                    ...current,
                                    jsonInitialValue: event.target.value,
                                }));
                                setErrorMessage(null);
                                setSuccessMessage(null);
                            }}
                            data-testid="variable-manager-json-input"
                        />
                    </label>
                ) : (
                    <label style={labelStyle}>
                        {t('variableManager.fields.initialValue', {defaultValue: '初始值'})}
                        <input
                            value={draft.scalarInitialValue}
                            style={inputStyle}
                            onChange={(event) => {
                                setDraft((current) => ({
                                    ...current,
                                    scalarInitialValue: event.target.value,
                                }));
                                setErrorMessage(null);
                                setSuccessMessage(null);
                            }}
                            data-testid="variable-manager-scalar-input"
                        />
                    </label>
                )}
                <div style={{display: 'flex', gap: 8}}>
                    <button
                        type="button"
                        style={buttonStyle}
                        onClick={handleSave}
                        data-testid="variable-manager-save-button"
                    >
                        {t('variableManager.actions.save', {defaultValue: '保存变量'})}
                    </button>
                    {!isCreating && selectedVariableName && (
                        <button
                            type="button"
                            style={dangerButtonStyle}
                            onClick={handleDelete}
                            data-testid="variable-manager-delete-button"
                        >
                            {t('variableManager.actions.delete', {defaultValue: '删除变量'})}
                        </button>
                    )}
                </div>
                {errorMessage && (
                    <div
                        style={{
                            ...messageStyle,
                            color: '#b91c1c',
                            background: 'rgba(254, 226, 226, 0.7)',
                        }}
                        data-testid="variable-manager-error"
                    >
                        {errorMessage}
                    </div>
                )}
                {successMessage && (
                    <div
                        style={{
                            ...messageStyle,
                            color: '#166534',
                            background: 'rgba(220, 252, 231, 0.8)',
                        }}
                        data-testid="variable-manager-success"
                    >
                        {successMessage}
                    </div>
                )}
            </section>

            <section style={sectionStyle}>
                <strong style={{fontSize: 12, color: '#334155'}}>
                    {t('variableManager.sections.usages', {
                        defaultValue: '引用位置',
                    })}
                </strong>
                {selectedVariableName === null || selectedUsages.length === 0 ? (
                    <div style={{fontSize: 12, color: '#64748b'}} data-testid="variable-manager-usage-empty">
                        {t('variableManager.usagesEmpty', {
                            defaultValue: '当前变量暂无引用。',
                        })}
                    </div>
                ) : (
                    <div style={{display: 'grid', gap: 8}}>
                        {selectedUsages.map((usage) => (
                            <button
                                key={`${usage.node_id}:${usage.field_name}`}
                                type="button"
                                style={listButtonStyle}
                                onClick={() => {
                                    selectNode(usage.node_id);
                                    onClose();
                                }}
                                data-testid={`variable-manager-usage-${usage.node_id}-${usage.field_name}`}
                            >
                                <div style={{fontWeight: 600, fontSize: 13}}>
                                    {usage.node_title || usage.node_id}
                                </div>
                                <div style={{fontSize: 12, color: '#475569'}}>
                                    {`${usage.node_id} · ${usage.node_type}`}
                                </div>
                                <div style={{fontSize: 11, color: '#64748b'}}>
                                    {getUsageFieldLabel(usage.field_name)}
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </section>
        </aside>
    );
}
