import {describe, expect, it} from 'vitest';

import enUS from '../../src/shared/i18n/locales/en-US.json';
import zhCN from '../../src/shared/i18n/locales/zh-CN.json';
import {translateGraphHistoryLabel} from '../../src/shared/i18n/label-mappers';
import i18n, {
    changeAppLanguage,
    defaultLanguage,
    detectInitialLanguage,
    getCurrentLanguage,
    localeStorageKey,
    normalizeLanguage,
} from '../../src/shared/i18n/i18n';

const flattenLocaleKeys = (value: Record<string, unknown>, prefix = ''): string[] =>
    Object.entries(value).flatMap(([key, child]) => {
        const nextKey = prefix ? `${prefix}.${key}` : key;
        if (child && typeof child === 'object' && !Array.isArray(child)) {
            return flattenLocaleKeys(child as Record<string, unknown>, nextKey);
        }
        return [nextKey];
    });

describe('i18n core', () => {
    it('resolves nested translation keys from language pack', () => {
        expect(i18n.t('app.title', {lng: 'zh-CN'})).toBe('StarryAI 工作台');
        expect(i18n.t('runControl.actions.start', {lng: 'zh-CN'})).toBe('启动运行');
        expect(i18n.t('nodeTypeDescriptions.data_requester', {lng: 'zh-CN'})).toBe('在触发时从被动容器读取当前数据。');
        expect(i18n.t('nodeConfig.data.writer.operations.merge_from_input', {lng: 'zh-CN'})).toBe('合并输入对象');
        expect(i18n.t('nodeConfig.data.ref.variable', {lng: 'en-US'})).toBe('Bound Variable');
        expect(i18n.t('graphEditor.nodeTypeBadges.dataRefUnbound', {lng: 'en-US'})).toBe('Unbound');
    });

    it('keeps zh-CN and en-US locale keys aligned', () => {
        expect(new Set(flattenLocaleKeys(zhCN as Record<string, unknown>))).toEqual(
            new Set(flattenLocaleKeys(enUS as Record<string, unknown>)),
        );
    });

    it('translates graph history labels and undo/redo wrappers', () => {
        const zhT = i18n.getFixedT('zh-CN');
        expect(translateGraphHistoryLabel(zhT, 'nodeConfigUpdated')).toBe('更新节点配置');
        expect(translateGraphHistoryLabel(zhT, 'undo:nodeConfigUpdated')).toBe('撤销：更新节点配置');
        expect(i18n.t('workbench.history.labels.nodeConfigUpdated', {lng: 'en-US'})).toBe('Updated node config');
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
