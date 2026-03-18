import {describe, expect, it} from 'vitest';

import i18n, {
    changeAppLanguage,
    defaultLanguage,
    detectInitialLanguage,
    getCurrentLanguage,
    localeStorageKey,
    normalizeLanguage,
} from '../../src/shared/i18n/i18n';

describe('i18n core', () => {
    it('resolves nested translation keys from language pack', () => {
        expect(i18n.t('app.title', {lng: 'zh-CN'})).toBe('StarryAI 工作台');
        expect(i18n.t('runControl.actions.start', {lng: 'zh-CN'})).toBe('启动运行');
        expect(i18n.t('nodeTypeDescriptions.data_requester', {lng: 'zh-CN'})).toBe('在触发时从被动容器读取当前数据。');
        expect(i18n.t('nodeConfig.data.writer.operations.merge_from_input', {lng: 'zh-CN'})).toBe('合并输入对象');
    });

    it('normalizes supported and alias language tags', () => {
        expect(normalizeLanguage('zh-CN')).toBe('zh-CN');
        expect(normalizeLanguage('zh')).toBe('zh-CN');
        expect(normalizeLanguage('en-US')).toBe('en-US');
        expect(normalizeLanguage('en')).toBe('en-US');
    });

    it('falls back to default language for unsupported values (edge path)', () => {
        expect(normalizeLanguage('fr-FR')).toBe(defaultLanguage);
        expect(normalizeLanguage('')).toBe(defaultLanguage);
        expect(normalizeLanguage(null)).toBe(defaultLanguage);
    });

    it('prioritizes stored language during initial detection', () => {
        window.localStorage.setItem(localeStorageKey, 'en-US');
        expect(detectInitialLanguage()).toBe('en-US');
    });

    it('uses default language when storage is empty or invalid (edge path)', () => {
        window.localStorage.removeItem(localeStorageKey);
        expect(detectInitialLanguage()).toBe(defaultLanguage);

        window.localStorage.setItem(localeStorageKey, 'invalid-locale');
        expect(detectInitialLanguage()).toBe(defaultLanguage);
    });

    it('changes language and persists selection', async () => {
        await changeAppLanguage('en-US');
        expect(window.localStorage.getItem(localeStorageKey)).toBe('en-US');
        expect(getCurrentLanguage()).toBe('en-US');

        await i18n.changeLanguage(defaultLanguage);
    });
});
