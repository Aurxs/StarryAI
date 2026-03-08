import {useMemo, useState, type CSSProperties} from 'react';
import {ChevronDown, ChevronRight, Plus} from 'lucide-react';
import {useTranslation} from 'react-i18next';

import type {CreateSecretRequest, SecretCatalogEntry} from '../../entities/workbench/types';
import {
    translateSchemaDescription,
    translateSchemaFieldLabel,
    translateSecretKind,
    translateSecretProvider,
} from '../i18n/label-mappers';
import {
    applySchemaDefaults,
    getOrderedObjectEntries,
    getRequiredFieldSet,
    isReadonlySchema,
    isSecretRef,
    isSecretSchema,
    isTextareaSchema,
    resolveSchemaNode,
    type JsonSchemaNode,
    type ResolvedSchemaNode,
} from './normalize-schema';

const formRootStyle: CSSProperties = {
    display: 'grid',
    gap: 10,
};

const objectSectionStyle: CSSProperties = {
    display: 'grid',
    gap: 10,
    paddingLeft: 12,
    borderLeft: '2px solid rgba(148, 163, 184, 0.28)',
};

const secretFieldStyle: CSSProperties = {
    display: 'grid',
    gap: 8,
    paddingTop: 6,
};

const labelStyle: CSSProperties = {
    display: 'grid',
    gap: 4,
    fontSize: 12,
    color: '#334155',
};

const inputStyle: CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid rgba(31, 41, 51, 0.24)',
    borderRadius: 8,
    padding: '8px 10px',
    fontSize: 13,
    color: '#0f172a',
    background: '#ffffff',
};

const textareaStyle: CSSProperties = {
    ...inputStyle,
    minHeight: 84,
    resize: 'vertical',
    fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
};

const helpTextStyle: CSSProperties = {
    fontSize: 11,
    color: '#64748b',
};

const readonlyValueStyle: CSSProperties = {
    fontSize: 13,
    color: '#0f172a',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    minHeight: 20,
    paddingTop: 2,
};

const inlineButtonStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    border: '1px solid rgba(31, 41, 51, 0.2)',
    borderRadius: 8,
    padding: '6px 10px',
    fontSize: 12,
    cursor: 'pointer',
    background: '#ffffff',
    color: '#0f172a',
    lineHeight: 1.1,
};

const badgeStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    border: '1px solid #cbd5e1',
    borderRadius: 999,
    padding: '2px 8px',
    background: '#f8fafc',
    color: '#475569',
    fontSize: 11,
};

interface SecretFieldProps {
    path: string;
    title: string;
    description?: string;
    required: boolean;
    value: unknown;
    disabled?: boolean;
    secrets: SecretCatalogEntry[];
    onChange: (value: unknown) => void;
    onCreateSecret: (request: CreateSecretRequest) => Promise<SecretCatalogEntry>;
}

function SecretField({
    path,
    title,
    description,
    required,
    value,
    disabled = false,
    secrets,
    onChange,
    onCreateSecret,
}: SecretFieldProps) {
    const {t} = useTranslation();
    const [creating, setCreating] = useState(false);
    const [createLabel, setCreateLabel] = useState('');
    const [createValue, setCreateValue] = useState('');
    const [localError, setLocalError] = useState<string | null>(null);

    const selectedSecretId = isSecretRef(value) ? value.secret_id : '';
    const selectedSecret = secrets.find((item) => item.secret_id === selectedSecretId) ?? null;

    const commitCreate = async (): Promise<void> => {
        setLocalError(null);
        if (!createLabel.trim()) {
            setLocalError(t('secretManager.errors.labelRequired'));
            return;
        }
        if (!createValue) {
            setLocalError(t('secretManager.errors.valueRequired'));
            return;
        }
        const created = await onCreateSecret({
            label: createLabel.trim(),
            value: createValue,
        });
        onChange({$kind: 'secret_ref', secret_id: created.secret_id});
        setCreateLabel('');
        setCreateValue('');
        setCreating(false);
    };

    return (
        <div style={secretFieldStyle} data-field-path={path}>
            <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10}}>
                <div>
                    <div style={{fontSize: 12, fontWeight: 600, color: '#334155'}}>
                        {title}{required ? ' *' : ''}
                    </div>
                    {description && <div style={helpTextStyle}>{description}</div>}
                </div>
                <span style={badgeStyle}>{t('nodeConfig.secret.badge')}</span>
            </div>
            <select
                value={selectedSecretId}
                onChange={(event) => {
                    const nextId = event.target.value;
                    if (!nextId) {
                        onChange(required ? value : undefined);
                        return;
                    }
                    onChange({$kind: 'secret_ref', secret_id: nextId});
                }}
                disabled={disabled}
                style={inputStyle}
            >
                <option value="">{t(required ? 'nodeConfig.secret.selectRequired' : 'nodeConfig.secret.selectOptional')}</option>
                {secrets.map((item) => (
                    <option key={item.secret_id} value={item.secret_id}>
                        {item.label} ({item.secret_id})
                    </option>
                ))}
            </select>
            {selectedSecret && (
                <div style={{display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 11, color: '#475569'}}>
                    <span style={badgeStyle}>
                        {t('secretManager.meta.kind', {kind: translateSecretKind(t, selectedSecret.kind)})}
                    </span>
                    <span style={badgeStyle}>
                        {t('secretManager.meta.provider', {provider: translateSecretProvider(t, selectedSecret.provider)})}
                    </span>
                    <span style={badgeStyle}>{t('secretManager.meta.usage', {count: selectedSecret.usage_count})}</span>
                </div>
            )}
            <div style={{display: 'flex', gap: 8, flexWrap: 'wrap'}}>
                <button type="button" style={inlineButtonStyle} onClick={() => setCreating((current) => !current)} disabled={disabled}>
                    <Plus size={14} aria-hidden="true"/>
                    {creating ? t('nodeConfig.secret.cancelCreate') : t('nodeConfig.secret.createInline')}
                </button>
                {!required && selectedSecretId && (
                    <button type="button" style={inlineButtonStyle} onClick={() => onChange(undefined)} disabled={disabled}>
                        {t('nodeConfig.secret.clear')}
                    </button>
                )}
            </div>
            {creating && (
                <div style={{display: 'grid', gap: 8}}>
                    <label style={labelStyle}>
                        {t('secretManager.fields.label')}
                        <input value={createLabel} onChange={(event) => setCreateLabel(event.target.value)} style={inputStyle}/>
                    </label>
                    <label style={labelStyle}>
                        {t('secretManager.fields.value')}
                        <textarea value={createValue} onChange={(event) => setCreateValue(event.target.value)} style={textareaStyle}/>
                    </label>
                    {localError && <div style={{fontSize: 12, color: '#9f1239'}}>{localError}</div>}
                    <div>
                        <button type="button" style={inlineButtonStyle} onClick={() => void commitCreate()}>
                            {t('nodeConfig.secret.createAndBind')}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

interface SchemaFormProps {
    nodeTypeName?: string;
    schema: JsonSchemaNode;
    value: Record<string, unknown>;
    secrets: SecretCatalogEntry[];
    onChange: (nextValue: Record<string, unknown>) => void;
    onCreateSecret: (request: CreateSecretRequest) => Promise<SecretCatalogEntry>;
}

const cloneRecord = (value: Record<string, unknown>): Record<string, unknown> =>
    JSON.parse(JSON.stringify(value)) as Record<string, unknown>;

const setValueAtPath = (
    currentValue: Record<string, unknown>,
    path: string[],
    nextFieldValue: unknown,
): Record<string, unknown> => {
    const nextValue = cloneRecord(currentValue);
    let cursor: Record<string, unknown> = nextValue;
    path.slice(0, -1).forEach((segment) => {
        const existing = cursor[segment];
        if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
            cursor[segment] = {};
        }
        cursor = cursor[segment] as Record<string, unknown>;
    });
    const leafKey = path[path.length - 1];
    if (nextFieldValue === undefined) {
        delete cursor[leafKey];
    } else {
        cursor[leafKey] = nextFieldValue;
    }
    return nextValue;
};

const getValueAtPath = (currentValue: Record<string, unknown>, path: string[]): unknown => {
    let cursor: unknown = currentValue;
    for (const segment of path) {
        if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) {
            return undefined;
        }
        cursor = (cursor as Record<string, unknown>)[segment];
    }
    return cursor;
};

const formatReadonlyValue = (value: unknown, emptyText: string): string => {
    if (value === undefined || value === null || value === '') {
        return emptyText;
    }
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    return JSON.stringify(value, null, 2);
};

interface SchemaFieldsProps {
    nodeTypeName?: string;
    schema: JsonSchemaNode;
    rootSchema: JsonSchemaNode;
    value: Record<string, unknown>;
    path: string[];
    secrets: SecretCatalogEntry[];
    onChange: (nextValue: Record<string, unknown>) => void;
    onCreateSecret: (request: CreateSecretRequest) => Promise<SecretCatalogEntry>;
}

function SchemaFields({nodeTypeName, schema, rootSchema, value, path, secrets, onChange, onCreateSecret}: SchemaFieldsProps) {
    const {t} = useTranslation();
    const requiredFields = getRequiredFieldSet(schema);

    return (
        <div style={{display: 'grid', gap: 10}}>
            {getOrderedObjectEntries(schema, rootSchema).map(([fieldKey, fieldSchema]) => {
                const fieldPath = [...path, fieldKey];
                const fieldValue = getValueAtPath(value, fieldPath);
                const required = requiredFields.has(fieldKey);
                const label = translateSchemaFieldLabel(t, fieldKey, fieldSchema.title ?? fieldKey);
                const description = translateSchemaDescription(t, fieldKey, fieldSchema.description, nodeTypeName);
                const resolvedType = fieldSchema.type;
                const readonlyValue = fieldValue ?? fieldSchema.default;

                if (isSecretSchema(fieldSchema)) {
                    return (
                        <SecretField
                            key={fieldPath.join('.')}
                            path={fieldPath.join('.')}
                            title={label}
                            description={description}
                            required={required}
                            value={fieldValue}
                            secrets={secrets}
                            onCreateSecret={onCreateSecret}
                            onChange={(nextFieldValue) => onChange(setValueAtPath(value, fieldPath, nextFieldValue))}
                        />
                    );
                }

                if (isReadonlySchema(fieldSchema)) {
                    return (
                        <div key={fieldPath.join('.')} style={labelStyle} data-field-path={fieldPath.join('.')}>
                            <span>{label}{required ? ' *' : ''}</span>
                            {description && <span style={helpTextStyle}>{description}</span>}
                            <div style={readonlyValueStyle}>
                                {formatReadonlyValue(readonlyValue, t('nodeConfig.form.emptyValue'))}
                            </div>
                        </div>
                    );
                }

                if (resolvedType === 'object' && fieldSchema.properties) {
                    const nestedValue = (() => {
                        if (fieldValue && typeof fieldValue === 'object' && !Array.isArray(fieldValue)) {
                            return fieldValue as Record<string, unknown>;
                        }
                        return {};
                    })();
                    return (
                        <section key={fieldPath.join('.')} style={objectSectionStyle}>
                            <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                                <ChevronRight size={16} aria-hidden="true"/>
                                <div>
                                    <div style={{fontSize: 12, fontWeight: 600, color: '#334155'}}>{label}</div>
                                    {description && <div style={helpTextStyle}>{description}</div>}
                                </div>
                            </div>
                            <SchemaFields
                                nodeTypeName={nodeTypeName}
                                schema={fieldSchema}
                                rootSchema={rootSchema}
                                value={nestedValue}
                                path={fieldPath}
                                secrets={secrets}
                                onCreateSecret={onCreateSecret}
                                onChange={(nextNestedValue) => onChange(setValueAtPath(value, fieldPath, nextNestedValue))}
                            />
                        </section>
                    );
                }

                if (Array.isArray(fieldSchema.enum)) {
                    return (
                        <label key={fieldPath.join('.')} style={labelStyle}>
                            {label}{required ? ' *' : ''}
                            {description && <span style={helpTextStyle}>{description}</span>}
                            <select
                                value={typeof fieldValue === 'string' ? fieldValue : String(fieldValue ?? fieldSchema.default ?? '')}
                                style={inputStyle}
                                onChange={(event) => onChange(setValueAtPath(value, fieldPath, event.target.value || undefined))}
                            >
                                {!required && <option value="">{t('nodeConfig.form.emptyValue')}</option>}
                                {fieldSchema.enum.map((enumValue) => (
                                    <option key={String(enumValue)} value={String(enumValue)}>
                                        {String(enumValue)}
                                    </option>
                                ))}
                            </select>
                        </label>
                    );
                }

                if (resolvedType === 'boolean') {
                    return (
                        <label key={fieldPath.join('.')} style={{...labelStyle, gridAutoFlow: 'column', justifyContent: 'space-between', alignItems: 'center'}}>
                            <span>
                                {label}{required ? ' *' : ''}
                                {description && <span style={{...helpTextStyle, display: 'block'}}>{description}</span>}
                            </span>
                            <input
                                type="checkbox"
                                checked={Boolean(fieldValue ?? fieldSchema.default ?? false)}
                                onChange={(event) => onChange(setValueAtPath(value, fieldPath, event.target.checked))}
                            />
                        </label>
                    );
                }

                if (resolvedType === 'integer' || resolvedType === 'number') {
                    return (
                        <label key={fieldPath.join('.')} style={labelStyle}>
                            {label}{required ? ' *' : ''}
                            {description && <span style={helpTextStyle}>{description}</span>}
                            <input
                                type="number"
                                min={typeof fieldSchema.minimum === 'number' ? fieldSchema.minimum : undefined}
                                max={typeof fieldSchema.maximum === 'number' ? fieldSchema.maximum : undefined}
                                value={typeof fieldValue === 'number' ? fieldValue : String(fieldValue ?? fieldSchema.default ?? '')}
                                style={inputStyle}
                                onChange={(event) => {
                                    const raw = event.target.value;
                                    if (!raw) {
                                        onChange(setValueAtPath(value, fieldPath, undefined));
                                        return;
                                    }
                                    const parsed = resolvedType === 'integer' ? Number.parseInt(raw, 10) : Number.parseFloat(raw);
                                    if (Number.isFinite(parsed)) {
                                        onChange(setValueAtPath(value, fieldPath, parsed));
                                    }
                                }}
                            />
                        </label>
                    );
                }

                if (resolvedType === 'string' || resolvedType === undefined) {
                    const useTextarea = isTextareaSchema(fieldSchema);
                    const currentText = typeof fieldValue === 'string'
                        ? fieldValue
                        : typeof fieldSchema.default === 'string'
                            ? fieldSchema.default
                            : '';
                    return (
                        <label key={fieldPath.join('.')} style={labelStyle}>
                            {label}{required ? ' *' : ''}
                            {description && <span style={helpTextStyle}>{description}</span>}
                            {useTextarea ? (
                                <textarea
                                    value={currentText}
                                    style={textareaStyle}
                                    onChange={(event) => onChange(setValueAtPath(value, fieldPath, event.target.value || undefined))}
                                />
                            ) : (
                                <input
                                    value={currentText}
                                    style={inputStyle}
                                    onChange={(event) => onChange(setValueAtPath(value, fieldPath, event.target.value || undefined))}
                                />
                            )}
                        </label>
                    );
                }

                return (
                    <section key={fieldPath.join('.')} style={objectSectionStyle}>
                        <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                            <ChevronDown size={16} aria-hidden="true"/>
                            <div>
                                <div style={{fontSize: 12, fontWeight: 600, color: '#334155'}}>{label}</div>
                                <div style={helpTextStyle}>{t('nodeConfig.form.unsupportedField', {fieldType: resolvedType ?? 'unknown'})}</div>
                            </div>
                        </div>
                    </section>
                );
            })}
        </div>
    );
}

export function SchemaForm({nodeTypeName, schema, value, secrets, onChange, onCreateSecret}: SchemaFormProps) {
    const {t} = useTranslation();
    const schemaRoot = useMemo(() => schema, [schema]);
    const effectiveValue = useMemo(() => applySchemaDefaults(schemaRoot, value), [schemaRoot, value]);
    const rootResolved = resolveSchemaNode(schemaRoot, schemaRoot);

    if (rootResolved.type !== 'object' || !rootResolved.properties) {
        return (
            <section style={objectSectionStyle} data-testid="schema-form-unsupported">
                <div style={{fontSize: 12, color: '#475569'}}>{t('nodeConfig.form.unsupportedRoot')}</div>
            </section>
        );
    }

    return (
        <section style={formRootStyle} data-testid="schema-form">
            <SchemaFields
                nodeTypeName={nodeTypeName}
                schema={schemaRoot}
                rootSchema={schemaRoot}
                value={effectiveValue}
                path={[]}
                secrets={secrets}
                onCreateSecret={onCreateSecret}
                onChange={onChange}
            />
        </section>
    );
}
