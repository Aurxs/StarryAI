import type {TFunction} from 'i18next';

import type {RunUiStatus} from '../state/run-store';
import type {LeftPanelKey, RightPanelKey} from '../state/ui-store';

const runStatusKeyMap: Record<RunUiStatus, string> = {
    idle: 'run.status.idle',
    validating: 'run.status.validating',
    running: 'run.status.running',
    stopped: 'run.status.stopped',
    completed: 'run.status.completed',
    failed: 'run.status.failed',
};

const leftPanelKeyMap: Record<LeftPanelKey, string> = {
    'node-library': 'workbench.panel.nodeLibrary',
    'graph-outline': 'workbench.panel.graphOutline',
};

const rightPanelKeyMap: Record<RightPanelKey, string> = {
    'node-config': 'workbench.panel.nodeConfig',
    'run-inspector': 'workbench.panel.runInspector',
};

const normalizeLookupValue = (value: string): string =>
    value
        .trim()
        .toLowerCase()
        .replace(/[.\s-]+/g, '_');

export const translateRunStatus = (t: TFunction, value: RunUiStatus): string =>
    t(runStatusKeyMap[value], {defaultValue: value});

export const translateLeftPanel = (t: TFunction, value: LeftPanelKey): string =>
    t(leftPanelKeyMap[value], {defaultValue: value});

export const translateRightPanel = (t: TFunction, value: RightPanelKey): string =>
    t(rightPanelKeyMap[value], {defaultValue: value});

export const translateSchemaFieldLabel = (
    t: TFunction,
    fieldKey: string,
    fallbackLabel?: string,
): string => {
    const defaultValue = fallbackLabel ?? fieldKey;
    return t(`nodeConfig.schemaFields.${fieldKey}`, {defaultValue});
};

export const translateSchemaDescription = (
    t: TFunction,
    fieldKey: string,
    fallbackDescription?: string,
    nodeTypeName?: string,
): string | undefined => {
    if (!fallbackDescription) {
        return undefined;
    }
    const normalizedTypeName = nodeTypeName ? normalizeLookupValue(nodeTypeName) : '';
    if (normalizedTypeName) {
        const nodeScoped = t(`nodeConfig.schemaFieldDescriptions.${normalizedTypeName}.${fieldKey}`, {
            defaultValue: '',
        });
        if (nodeScoped) {
            return nodeScoped;
        }
    }
    return t(`nodeConfig.schemaFieldDescriptions._shared.${fieldKey}`, {
        defaultValue: fallbackDescription,
    });
};

export const translateSecretKind = (t: TFunction, value: string): string => {
    return t(`secretManager.kinds.${normalizeLookupValue(value)}`, {defaultValue: value});
};

export const translateSecretProvider = (t: TFunction, value: string): string => {
    return t(`secretManager.providers.${normalizeLookupValue(value)}`, {defaultValue: value});
};

export const translateNodeTypeDescription = (
    t: TFunction,
    typeName: string,
    fallbackDescription?: string,
): string | undefined => {
    if (!fallbackDescription) {
        return undefined;
    }
    return t(`nodeTypeDescriptions.${normalizeLookupValue(typeName)}`, {
        defaultValue: fallbackDescription,
    });
};

export const translatePortDescription = (
    t: TFunction,
    typeName: string,
    portName: string,
    fallbackDescription?: string,
): string | undefined => {
    if (!fallbackDescription) {
        return undefined;
    }
    return t(`nodePortDescriptions.${normalizeLookupValue(typeName)}.${portName}`, {
        defaultValue: fallbackDescription,
    });
};
