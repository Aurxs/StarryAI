import type {TFunction} from 'i18next';

import {getValueKindLabel} from '../data-registry';
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

const graphHistoryActionKeyMap: Record<string, string> = {
    graphMetaUpdated: 'workbench.history.labels.graphMetaUpdated',
    nodesUpdated: 'workbench.history.labels.nodesUpdated',
    edgesUpdated: 'workbench.history.labels.edgesUpdated',
    variableCreated: 'workbench.history.labels.variableCreated',
    constantCreated: 'workbench.history.labels.constantCreated',
    variableUpdated: 'workbench.history.labels.variableUpdated',
    variableRenamed: 'workbench.history.labels.variableRenamed',
    variableDeleted: 'workbench.history.labels.variableDeleted',
    nodeUpdated: 'workbench.history.labels.nodeUpdated',
    nodeCreated: 'workbench.history.labels.nodeCreated',
    nodeConfigUpdated: 'workbench.history.labels.nodeConfigUpdated',
    nodeDeleted: 'workbench.history.labels.nodeDeleted',
};

const graphVariableUsageFieldKeyMap: Record<string, string> = {
    variable_name: 'graphVariable.usageFields.variableName',
    target_variable_name: 'graphVariable.usageFields.targetVariableName',
    operand_variable_name: 'graphVariable.usageFields.operandVariableName',
};

const graphVariableValueKindKeyMap: Record<string, string> = {
    'scalar.int': 'graphVariable.valueKinds.scalarInt',
    'scalar.float': 'graphVariable.valueKinds.scalarFloat',
    'scalar.string': 'graphVariable.valueKinds.scalarString',
    'json.list': 'graphVariable.valueKinds.jsonList',
    'json.dict': 'graphVariable.valueKinds.jsonDict',
    'json.any': 'graphVariable.valueKinds.jsonAny',
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

export const translateGraphHistoryLabel = (t: TFunction, value: string): string => {
    if (value.startsWith('undo:')) {
        return t('workbench.history.labels.undo', {
            action: translateGraphHistoryLabel(t, value.slice(5)),
            defaultValue: value,
        });
    }
    if (value.startsWith('redo:')) {
        return t('workbench.history.labels.redo', {
            action: translateGraphHistoryLabel(t, value.slice(5)),
            defaultValue: value,
        });
    }
    const key = graphHistoryActionKeyMap[value];
    return key ? t(key, {defaultValue: value}) : value;
};

export const translateVariableUsageField = (t: TFunction, fieldName: string): string => {
    const key = graphVariableUsageFieldKeyMap[fieldName];
    return key ? t(key, {defaultValue: fieldName}) : fieldName;
};

export const translateValueKind = (t: TFunction, valueKind: string): string => {
    const key = graphVariableValueKindKeyMap[valueKind];
    const fallbackLabel = getValueKindLabel(valueKind);
    return key ? t(key, {defaultValue: fallbackLabel}) : fallbackLabel;
};
