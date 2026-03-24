import {useEffect, useState, type CSSProperties} from 'react';
import {X} from 'lucide-react';
import {useTranslation} from 'react-i18next';

import type {CreateSecretRequest, SecretCatalogEntry, UpdateSecretRequest} from '../../entities/workbench/types';

const overlayStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.36)',
    display: 'grid',
    placeItems: 'center',
    padding: 16,
    zIndex: 2200,
};

const dialogStyle: CSSProperties = {
    width: 'min(520px, 100%)',
    borderRadius: 14,
    border: '1px solid #dce3ee',
    background: '#ffffff',
    boxShadow: '0 18px 38px rgba(15, 23, 42, 0.22)',
    padding: 16,
    display: 'grid',
    gap: 12,
};

const headerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
};

const titleStyle: CSSProperties = {
    fontSize: 15,
    fontWeight: 700,
    color: '#0f172a',
};

const closeButtonStyle: CSSProperties = {
    width: 28,
    height: 28,
    border: '1px solid #d5dff0',
    borderRadius: 8,
    background: '#fff',
    color: '#475569',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
};

const fieldGridStyle: CSSProperties = {
    display: 'grid',
    gap: 10,
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
    minHeight: 36,
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    padding: '8px 10px',
    fontSize: 13,
    color: '#0f172a',
    background: '#ffffff',
};

const textareaStyle: CSSProperties = {
    ...inputStyle,
    minHeight: 86,
    resize: 'vertical',
};

const footerStyle: CSSProperties = {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
};

const secondaryButtonStyle: CSSProperties = {
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    background: '#ffffff',
    color: '#334155',
    cursor: 'pointer',
    padding: '8px 12px',
    fontSize: 12,
};

const primaryButtonStyle: CSSProperties = {
    ...secondaryButtonStyle,
    borderColor: '#0f172a',
    background: '#0f172a',
    color: '#f8fafc',
};

type SecretDialogMode = 'create' | 'edit' | 'rotate';

interface SecretEditorDialogProps {
    mode: SecretDialogMode;
    item?: SecretCatalogEntry | null;
    submitting?: boolean;
    errorMessage?: string | null;
    onClose: () => void;
    onCreate: (request: CreateSecretRequest) => Promise<void>;
    onUpdate: (secretId: string, request: UpdateSecretRequest) => Promise<void>;
    onRotate: (secretId: string, value: string) => Promise<void>;
}

export function SecretEditorDialog({
    mode,
    item,
    submitting = false,
    errorMessage = null,
    onClose,
    onCreate,
    onUpdate,
    onRotate,
}: SecretEditorDialogProps) {
    const {t} = useTranslation();
    const [label, setLabel] = useState('');
    const [secretId, setSecretId] = useState('');
    const [kind, setKind] = useState('generic');
    const [description, setDescription] = useState('');
    const [value, setValue] = useState('');
    const [localError, setLocalError] = useState<string | null>(null);

    useEffect(() => {
        setLabel(item?.label ?? '');
        setSecretId(item?.secret_id ?? '');
        setKind(item?.kind ?? 'generic');
        setDescription(item?.description ?? '');
        setValue('');
        setLocalError(null);
    }, [item, mode]);

    const title = mode === 'create'
        ? t('secretManager.dialog.createTitle')
        : mode === 'edit'
            ? t('secretManager.dialog.editTitle')
            : t('secretManager.dialog.rotateTitle');

    const handleSubmit = async (): Promise<void> => {
        setLocalError(null);
        try {
            if (mode === 'rotate') {
                if (!item) {
                    setLocalError(t('secretManager.errors.missingItem'));
                    return;
                }
                if (!value) {
                    setLocalError(t('secretManager.errors.valueRequired'));
                    return;
                }
                await onRotate(item.secret_id, value);
                return;
            }

            if (!label.trim()) {
                setLocalError(t('secretManager.errors.labelRequired'));
                return;
            }
            if (!kind.trim()) {
                setLocalError(t('secretManager.errors.kindRequired'));
                return;
            }

            if (mode === 'create') {
                if (!value) {
                    setLocalError(t('secretManager.errors.valueRequired'));
                    return;
                }
                await onCreate({
                    label: label.trim(),
                    value,
                    kind: kind.trim(),
                    description: description.trim(),
                    secret_id: secretId.trim() || null,
                });
                return;
            }

            if (!item) {
                setLocalError(t('secretManager.errors.missingItem'));
                return;
            }
            await onUpdate(item.secret_id, {
                label: label.trim(),
                kind: kind.trim(),
                description: description.trim(),
            });
        } catch (error) {
            if (!errorMessage) {
                setLocalError(error instanceof Error ? error.message : String(error));
            }
        }
    };

    return (
        <div
            aria-label="secret-editor-overlay"
            style={overlayStyle}
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                    onClose();
                }
            }}
        >
            <section
                role="dialog"
                aria-modal="true"
                aria-label={title}
                style={dialogStyle}
                onMouseDown={(event) => event.stopPropagation()}
            >
                <div style={headerStyle}>
                    <strong style={titleStyle}>{title}</strong>
                    <button type="button" style={closeButtonStyle} onClick={onClose} aria-label={t('common.close')}>
                        <X size={14} aria-hidden="true"/>
                    </button>
                </div>

                <div style={fieldGridStyle}>
                    {mode !== 'rotate' && (
                        <>
                            <label style={labelStyle}>
                                {t('secretManager.fields.label')}
                                <input value={label} onChange={(event) => setLabel(event.target.value)} style={inputStyle}/>
                            </label>
                            <label style={labelStyle}>
                                {t('secretManager.fields.kind')}
                                <input value={kind} onChange={(event) => setKind(event.target.value)} style={inputStyle}/>
                            </label>
                            {mode === 'create' && (
                                <label style={labelStyle}>
                                    {t('secretManager.fields.secretId')}
                                    <input value={secretId} onChange={(event) => setSecretId(event.target.value)} style={inputStyle}/>
                                </label>
                            )}
                            <label style={labelStyle}>
                                {t('secretManager.fields.description')}
                                <textarea value={description} onChange={(event) => setDescription(event.target.value)} style={textareaStyle}/>
                            </label>
                        </>
                    )}

                    {(mode === 'create' || mode === 'rotate') && (
                        <label style={labelStyle}>
                            {t('secretManager.fields.value')}
                            <textarea
                                value={value}
                                onChange={(event) => setValue(event.target.value)}
                                style={textareaStyle}
                            />
                        </label>
                    )}
                </div>

                {(localError || errorMessage) && (
                    <div style={{fontSize: 12, color: '#9f1239'}}>{localError ?? errorMessage}</div>
                )}

                <div style={footerStyle}>
                    <button type="button" style={secondaryButtonStyle} onClick={onClose}>
                        {t('common.cancel')}
                    </button>
                    <button type="button" style={primaryButtonStyle} onClick={() => void handleSubmit()} disabled={submitting}>
                        {submitting ? t('common.saving') : t('common.save')}
                    </button>
                </div>
            </section>
        </div>
    );
}
