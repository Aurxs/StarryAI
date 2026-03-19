import {useEffect, useMemo, useState, type CSSProperties} from 'react';
import {X} from 'lucide-react';
import {useTranslation} from 'react-i18next';

import {type GraphVariableSpec} from '../../entities/workbench/types';
import {GRAPH_VARIABLE_VALUE_KINDS, readDataRegistry} from '../../shared/data-registry';
import {
    createDefaultVariableDraft,
    formatVariableInitialValue,
    parseVariableInitialValue,
    summarizeVariableInitialValue,
    type GraphVariableDraft,
} from '../../shared/graph-variables';
import {translateValueKind, translateVariableUsageField} from '../../shared/i18n/label-mappers';
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
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
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
    border: '1px solid #cbd5e1',
    background: '#ffffff',
};

const editorPanelStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: '12px 12px 14px',
    border: '1px solid #dce3ee',
    borderRadius: 12,
    background: 'rgba(255, 255, 255, 0.98)',
    height: '100%',
    boxSizing: 'border-box',
    overflow: 'auto',
};

const overlayStyle: CSSProperties = {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 2,
};

const overlayPanelStyle: CSSProperties = {
    ...editorPanelStyle,
    background: 'rgba(255, 255, 255, 0.98)',
};

const OVERLAY_GAP = 8;
const FLOATING_CARD_TRANSITION = 'transform 240ms cubic-bezier(0.22, 1, 0.36, 1)';
const PANEL_ENTER_TRANSITION = 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)';
const PANEL_HIDDEN_TRANSFORM = 'translateY(calc(100% + 16px))';

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

const constantBadgeStyle: CSSProperties = {
    fontSize: 10,
    borderRadius: 999,
    padding: '1px 6px',
    background: 'rgba(59, 130, 246, 0.12)',
    color: '#1d4ed8',
    border: '1px solid rgba(59, 130, 246, 0.3)',
    flexShrink: 0,
    lineHeight: 1.4,
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

const labelStyle: CSSProperties = {
    display: 'grid',
    gap: 4,
    fontSize: 12,
    color: '#334155',
};

const readonlyValueStyle: CSSProperties = {
    marginTop: 4,
    border: '1px solid rgba(148, 163, 184, 0.28)',
    borderRadius: 8,
    padding: '8px 10px',
    fontSize: 13,
    color: '#334155',
    background: '#f8fafc',
    minHeight: 18,
    display: 'flex',
    alignItems: 'center',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
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
        isConstant: Boolean(variable.is_constant),
        valueKind: variable.value_kind,
        scalarInitialValue: formatted.scalar || (variable.value_kind === 'scalar.int' ? '0' : ''),
        jsonInitialValue: formatted.json,
    };
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
    const [overlayEntered, setOverlayEntered] = useState(false);
    const [floatingCardStartTop, setFloatingCardStartTop] = useState(0);

    const selectedVariable = useMemo(
        () => variables.find((variable) => variable.name === selectedVariableName) ?? null,
        [selectedVariableName, variables],
    );
    const selectedVariableIsConstant = Boolean(selectedVariable?.is_constant);
    const selectedUsages = useMemo(
        () => (!isCreating && selectedVariableName ? getVariableUsages(selectedVariableName) : []),
        [getVariableUsages, isCreating, selectedVariableName],
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
    const activeOverlayMode = isCreating ? 'create' : selectedVariable ? 'edit' : null;
    const constantReadonlyMessage = t('variableManager.errors.constantReadonly', {
        defaultValue: '常量只能创建，不能修改或删除',
    });
    const clearFeedback = () => {
        setErrorMessage(null);
        setSuccessMessage(null);
    };

    useEffect(() => {
        if (!open) {
            return;
        }
        if (isCreating) {
            return;
        }
        if (variables.length === 0) {
            setIsCreating(true);
            setSelectedVariableName(null);
            setDraft(createDefaultVariableDraft());
            return;
        }
        if (selectedVariableName && !selectedVariable) {
            setSelectedVariableName(null);
            setDraft(createDefaultVariableDraft());
        }
    }, [isCreating, open, selectedVariable, selectedVariableName, variables]);

    useEffect(() => {
        if (!activeOverlayMode) {
            setOverlayEntered(false);
            return;
        }
        setOverlayEntered(false);
        const frame = window.requestAnimationFrame(() => {
            setOverlayEntered(true);
        });
        return () => {
            window.cancelAnimationFrame(frame);
        };
    }, [activeOverlayMode, selectedVariableName]);

    if (!open) {
        return null;
    }

    const beginCreate = () => {
        setIsCreating(true);
        setSelectedVariableName(null);
        setFloatingCardStartTop(0);
        setDraft(createDefaultVariableDraft());
        clearFeedback();
    };

    const selectVariableForEdit = (variable: GraphVariableSpec, sourceTop = 0) => {
        if (!isCreating && selectedVariableName === variable.name) {
            setSelectedVariableName(null);
            setFloatingCardStartTop(0);
            setDraft(createDefaultVariableDraft());
            clearFeedback();
            return;
        }
        setIsCreating(false);
        setSelectedVariableName(variable.name);
        setFloatingCardStartTop(sourceTop);
        setDraft(buildDraftFromVariable(variable));
        clearFeedback();
    };

    const handleSave = () => {
        try {
            if (!isCreating && selectedVariableIsConstant) {
                throw new Error(constantReadonlyMessage);
            }
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
                variableParseMessages,
            );

            if (isCreating || !selectedVariableName) {
                const created = createVariable({
                    name: normalizedName,
                    is_constant: draft.isConstant,
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
                const nextVariable: GraphVariableSpec = {
                    name: normalizedName,
                    is_constant: draft.isConstant,
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

            const nextVariable: GraphVariableSpec = {
                name: effectiveName,
                is_constant: selectedVariableIsConstant,
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
        if (selectedVariableIsConstant) {
            setErrorMessage(constantReadonlyMessage);
            setSuccessMessage(null);
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

    const renderVariableForm = (mode: 'create' | 'edit') => {
        const isEditMode = mode === 'edit';
        const readonly = isEditMode && selectedVariableIsConstant;
        const kindLabel = draft.isConstant
            ? t('graphVariable.entryKinds.constant', {defaultValue: '常量'})
            : t('graphVariable.entryKinds.variable', {defaultValue: '变量'});
        const initialValueSummary = draft.valueKind.startsWith('json.')
            ? draft.jsonInitialValue
            : draft.scalarInitialValue;

        return (
            <div
                style={{
                    ...(isEditMode ? editorPanelStyle : overlayPanelStyle),
                    transform: overlayEntered ? 'translateY(0)' : PANEL_HIDDEN_TRANSFORM,
                    transition: PANEL_ENTER_TRANSITION,
                }}
                data-testid={isEditMode ? 'variable-manager-edit-panel' : 'variable-manager-create-overlay'}
            >
                <strong style={{fontSize: 12, color: '#334155'}}>
                    {readonly
                        ? t('variableManager.sections.readonly', {defaultValue: '常量详情'})
                        : isEditMode
                            ? t('variableManager.sections.edit', {defaultValue: '编辑变量'})
                            : t('variableManager.sections.create', {defaultValue: '新建变量'})}
                </strong>
                {readonly && (
                    <div
                        style={{
                            ...messageStyle,
                            color: '#1d4ed8',
                            background: 'rgba(219, 234, 254, 0.8)',
                        }}
                        data-testid="variable-manager-readonly-hint"
                    >
                        {t('variableManager.readonlyHint', {
                            defaultValue: '常量只能创建，不能修改或删除。',
                        })}
                    </div>
                )}
                <label style={labelStyle}>
                    {t('variableManager.fields.name', {defaultValue: '变量名称'})}
                    {readonly ? (
                        <div style={readonlyValueStyle} data-testid="variable-manager-name-readonly">
                            {draft.name}
                        </div>
                    ) : (
                        <input
                            value={draft.name}
                            style={duplicateName ? invalidInputStyle : inputStyle}
                            onChange={(event) => {
                                setDraft((current) => ({...current, name: event.target.value}));
                                clearFeedback();
                            }}
                            data-testid="variable-manager-name-input"
                        />
                    )}
                </label>
                <label style={labelStyle}>
                    {t('variableManager.fields.kind', {defaultValue: '条目类型'})}
                    {isEditMode ? (
                        <div style={readonlyValueStyle} data-testid="variable-manager-kind-readonly">
                            {kindLabel}
                        </div>
                    ) : (
                        <select
                            value={draft.isConstant ? 'constant' : 'variable'}
                            style={inputStyle}
                            onChange={(event) => {
                                setDraft((current) => ({
                                    ...current,
                                    isConstant: event.target.value === 'constant',
                                }));
                                clearFeedback();
                            }}
                            data-testid="variable-manager-kind-select"
                        >
                            <option value="variable">
                                {t('graphVariable.entryKinds.variable', {defaultValue: '变量'})}
                            </option>
                            <option value="constant">
                                {t('graphVariable.entryKinds.constant', {defaultValue: '常量'})}
                            </option>
                        </select>
                    )}
                </label>
                <label style={labelStyle}>
                    {t('variableManager.fields.type', {defaultValue: '变量类型'})}
                    {readonly ? (
                        <div style={readonlyValueStyle} data-testid="variable-manager-type-readonly">
                            {translateValueKind(t, draft.valueKind)}
                        </div>
                    ) : (
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
                                    jsonInitialValue: current.jsonInitialValue,
                                }));
                                clearFeedback();
                            }}
                            data-testid="variable-manager-type-select"
                        >
                            {GRAPH_VARIABLE_VALUE_KINDS.map((valueKind) => (
                                <option key={valueKind} value={valueKind}>
                                    {translateValueKind(t, valueKind)}
                                </option>
                            ))}
                        </select>
                    )}
                </label>
                {readonly ? (
                    <label style={labelStyle}>
                        {draft.valueKind.startsWith('json.')
                            ? t('variableManager.fields.initialJson', {defaultValue: '初始值 JSON'})
                            : t('variableManager.fields.initialValue', {defaultValue: '初始值'})}
                        <div style={readonlyValueStyle} data-testid="variable-manager-initial-readonly">
                            {initialValueSummary || ' '}
                        </div>
                    </label>
                ) : draft.valueKind.startsWith('json.') ? (
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
                                clearFeedback();
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
                                clearFeedback();
                            }}
                            data-testid="variable-manager-scalar-input"
                        />
                    </label>
                )}
                {!readonly && (
                    <div style={{display: 'flex', gap: 8}}>
                        <button
                            type="button"
                            style={buttonStyle}
                            onClick={handleSave}
                            data-testid="variable-manager-save-button"
                        >
                            {t('variableManager.actions.save', {defaultValue: '保存变量'})}
                        </button>
                        {isEditMode && selectedVariableName && (
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
                )}
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
                {isEditMode && (
                    <section style={{display: 'grid', gap: 8}}>
                        <strong style={{fontSize: 12, color: '#334155'}}>
                            {t('variableManager.sections.usages', {
                                defaultValue: '引用位置',
                            })}
                        </strong>
                        {selectedUsages.length === 0 ? (
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
                                            {translateVariableUsageField(t, usage.field_name)}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </section>
                )}
            </div>
        );
    };

    const renderVariableCard = (variable: GraphVariableSpec, selected: boolean, floating = false) => {
        const usageCount = getVariableUsages(variable.name).length;

        return (
            <button
                type="button"
                style={selected ? selectedListButtonStyle : listButtonStyle}
                onClick={(event) => {
                    const sourceTop = floating
                        ? 0
                        : (event.currentTarget.parentElement as HTMLDivElement | null)?.offsetTop ?? 0;
                    selectVariableForEdit(variable, sourceTop);
                }}
                data-testid={floating ? `variable-manager-floating-item-${variable.name}` : `variable-manager-item-${variable.name}`}
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
                        {variable.is_constant ? (
                            <span
                                style={constantBadgeStyle}
                                data-testid={floating ? undefined : `variable-manager-constant-badge-${variable.name}`}
                            >
                                {t('graphVariable.entryKinds.constant', {defaultValue: '常量'})}
                            </span>
                        ) : null}
                        <span style={buildVariableTypeBadgeStyle(variable.value_kind)}>
                            {translateValueKind(t, variable.value_kind)}
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
    };

    return (
        <aside aria-label="variable-manager-drawer" style={drawerStyle} data-testid="variable-manager-drawer">
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                <strong>
                    {t('variableManager.title', {
                        defaultValue: '变量与常量',
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

            <section style={{display: 'flex', flexDirection: 'column', gap: 10, flex: '1 1 auto', minHeight: 0}}>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                    <strong style={{fontSize: 12, color: '#334155'}}>
                        {t('variableManager.sections.list', {
                            defaultValue: '变量与常量列表',
                        })}
                    </strong>
                    <button
                        type="button"
                        style={buttonStyle}
                        onClick={beginCreate}
                        data-testid="variable-manager-new-button"
                    >
                        {t('variableManager.actions.new', {defaultValue: '新建变量/常量'})}
                    </button>
                </div>
                <div
                    style={{
                        position: 'relative',
                        flex: '1 1 auto',
                        minHeight: 0,
                        overflow: 'auto',
                    }}
                >
                    <div
                        style={{
                            display: 'grid',
                            gap: 8,
                            alignContent: 'start',
                            opacity: isCreating ? 0.18 : 1,
                            pointerEvents: isCreating ? 'none' : undefined,
                            userSelect: isCreating ? 'none' : undefined,
                            minHeight: '100%',
                        }}
                        data-testid="variable-manager-list"
                    >
                        {variables.length === 0 ? (
                            <div style={{fontSize: 12, color: '#64748b'}} data-testid="variable-manager-empty">
                                {t('variableManager.empty', {
                                    defaultValue: '当前图还没有变量或常量。',
                                })}
                            </div>
                        ) : (
                            variables.map((variable) => {
                                const selected = !isCreating && variable.name === selectedVariableName;

                                return (
                                    <div
                                        key={variable.name}
                                        style={{
                                            display: 'grid',
                                            gap: 8,
                                            visibility: selected ? 'hidden' : 'visible',
                                        }}
                                        data-testid={`variable-manager-row-${variable.name}`}
                                    >
                                        {renderVariableCard(variable, selected)}
                                    </div>
                                );
                            })
                        )}
                    </div>
                    {!isCreating && selectedVariable && (
                        <div
                            style={{
                                ...overlayStyle,
                                top: 0,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: OVERLAY_GAP,
                                pointerEvents: 'none',
                            }}
                            data-testid="variable-manager-edit-overlay"
                        >
                            <div
                                style={{
                                    transform: overlayEntered ? 'translateY(0)' : `translateY(${floatingCardStartTop}px)`,
                                    transition: FLOATING_CARD_TRANSITION,
                                    pointerEvents: 'auto',
                                    willChange: 'transform',
                                }}
                                data-testid="variable-manager-floating-card"
                            >
                                {renderVariableCard(selectedVariable, true, true)}
                            </div>
                            <div
                                style={{
                                    flex: '1 1 auto',
                                    minHeight: 0,
                                    pointerEvents: 'auto',
                                }}
                            >
                                {renderVariableForm('edit')}
                            </div>
                        </div>
                    )}
                    {isCreating && (
                        <div
                            style={{
                                ...overlayStyle,
                                top: 0,
                            }}
                        >
                            {renderVariableForm('create')}
                        </div>
                    )}
                </div>
            </section>
        </aside>
    );
}
