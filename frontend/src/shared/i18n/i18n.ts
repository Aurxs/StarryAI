import i18n from 'i18next';
import {initReactI18next} from 'react-i18next';

import enUS from './locales/en-US.json';
import zhCN from './locales/zh-CN.json';

export const localeStorageKey = 'starryai.locale';
export const supportedLanguages = ['zh-CN', 'en-US'] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];
export const defaultLanguage: SupportedLanguage = 'zh-CN';

const supportedSet = new Set<string>(supportedLanguages);

export const normalizeLanguage = (value: string | null | undefined): SupportedLanguage => {
    if (!value) {
        return defaultLanguage;
    }
    const trimmed = value.trim();
    if (supportedSet.has(trimmed)) {
        return trimmed as SupportedLanguage;
    }
    const lowered = trimmed.toLowerCase();
    if (lowered.startsWith('zh')) {
        return 'zh-CN';
    }
    if (lowered.startsWith('en')) {
        return 'en-US';
    }
    return defaultLanguage;
};

export const detectInitialLanguage = (): SupportedLanguage => {
    if (typeof window === 'undefined') {
        return defaultLanguage;
    }

    try {
        const stored = window.localStorage.getItem(localeStorageKey);
        if (stored) {
            return normalizeLanguage(stored);
        }
    } catch {
        // Ignore localStorage read failures in restricted environments.
    }

    return defaultLanguage;
};

const resources = {
    'zh-CN': {
        translation: zhCN,
    },
    'en-US': {
        translation: enUS,
    },
} as const;

if (!i18n.isInitialized) {
    void i18n
        .use(initReactI18next)
        .init({
            resources,
            ns: ['translation'],
            defaultNS: 'translation',
            lng: detectInitialLanguage(),
            fallbackLng: defaultLanguage,
            load: 'currentOnly',
            initImmediate: false,
            ignoreJSONStructure: false,
            interpolation: {
                escapeValue: false,
            },
        });
}

export const persistLanguage = (language: SupportedLanguage): void => {
    if (typeof window === 'undefined') {
        return;
    }
    try {
        window.localStorage.setItem(localeStorageKey, language);
    } catch {
        // Ignore localStorage write failures in restricted environments.
    }
};

export const changeAppLanguage = async (language: SupportedLanguage): Promise<void> => {
    persistLanguage(language);
    await i18n.changeLanguage(language);
};

export const getCurrentLanguage = (): SupportedLanguage =>
    normalizeLanguage(i18n.resolvedLanguage ?? i18n.language);

export default i18n;
