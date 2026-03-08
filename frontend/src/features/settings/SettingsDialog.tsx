import {type CSSProperties} from 'react';
import {createPortal} from 'react-dom';
import {X} from 'lucide-react';
import {useTranslation} from 'react-i18next';

import {supportedLanguages} from '../../shared/i18n/i18n';
import {SecretManagerPanel} from './SecretManagerPanel';

const overlayStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 2000,
    background: 'rgba(2, 6, 23, 0.62)',
    display: 'grid',
    placeItems: 'center',
    padding: 20,
};

const dialogStyle: CSSProperties = {
    width: 'min(760px, 100%)',
    maxHeight: 'min(720px, calc(100dvh - 40px))',
    border: '1px solid #dce3ee',
    borderRadius: 14,
    boxShadow: '0 18px 34px rgba(15, 23, 42, 0.22)',
    background: '#ffffff',
    fontFamily: '"Avenir Next", "Segoe UI", sans-serif',
    padding: 14,
    display: 'grid',
    gap: 14,
};

const titleStyle: CSSProperties = {
    fontSize: 15,
    fontWeight: 700,
    color: '#0f172a',
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
};

const contentStyle: CSSProperties = {
    display: 'grid',
    gap: 20,
    overflow: 'auto',
    paddingRight: 2,
};

const sectionStyle: CSSProperties = {
    display: 'grid',
    gap: 12,
};

const sectionHeaderStyle: CSSProperties = {
    fontSize: 14,
    fontWeight: 700,
    color: '#0f172a',
};

const sectionDividerStyle: CSSProperties = {
    paddingTop: 18,
    borderTop: '1px solid #e2e8f0',
};

const fieldLabelStyle: CSSProperties = {
    display: 'block',
    fontSize: 13,
    fontWeight: 600,
    color: '#334155',
    marginBottom: 6,
};

const selectStyle: CSSProperties = {
    width: '100%',
    height: 34,
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    background: '#ffffff',
    color: '#0f172a',
    fontSize: 13,
    padding: '0 10px',
};

interface SettingsDialogProps {
    open: boolean;
    currentLanguage: string;
    onClose: () => void;
    onLanguageChange: (language: string) => void;
}

export function SettingsDialog({open, currentLanguage, onClose, onLanguageChange}: SettingsDialogProps) {
    const {t} = useTranslation();

    if (!open || typeof document === 'undefined') {
        return null;
    }

    return createPortal(
        <div
            aria-label="settings-overlay"
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
                aria-label={t('graphEditor.settings.title')}
                data-testid="settings-dialog"
                style={dialogStyle}
                onMouseDown={(event) => event.stopPropagation()}
            >
                <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10}}>
                    <strong style={titleStyle}>{t('graphEditor.settings.title')}</strong>
                    <button type="button" style={closeButtonStyle} onClick={onClose} aria-label={t('graphEditor.settings.close')}>
                        <X size={14} strokeWidth={2.1} aria-hidden="true"/>
                    </button>
                </div>

                <div style={contentStyle}>
                    <section data-testid="settings-general-panel" style={sectionStyle}>
                        <div style={sectionHeaderStyle}>{t('graphEditor.settings.tabs.general')}</div>
                        <label htmlFor="app-language-select" style={fieldLabelStyle}>
                            {t('language.label')}
                        </label>
                        <select
                            id="app-language-select"
                            value={currentLanguage}
                            style={selectStyle}
                            onChange={(event) => onLanguageChange(event.target.value)}
                        >
                            {supportedLanguages.map((language) => (
                                <option key={language} value={language}>
                                    {t(`language.${language}`)}
                                </option>
                            ))}
                        </select>
                    </section>

                    <section data-testid="settings-secrets-panel" style={{...sectionStyle, ...sectionDividerStyle}}>
                        <div style={sectionHeaderStyle}>{t('secretManager.title')}</div>
                        <SecretManagerPanel listMaxHeight={null}/>
                    </section>
                </div>
            </section>
        </div>,
        document.body,
    );
}
