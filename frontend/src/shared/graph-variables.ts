import type {GraphVariableSpec, GraphVariableValueKind} from '../entities/workbench/types';

export interface GraphVariableDraft {
    name: string;
    valueKind: GraphVariableValueKind;
    scalarInitialValue: string;
    jsonInitialValue: string;
}

const formatJsonValue = (value: unknown): string => JSON.stringify(value ?? null, null, 2);

const parseInteger = (value: string): number | null => {
    const trimmed = value.trim();
    if (!trimmed || !/^-?\d+$/.test(trimmed)) {
        return null;
    }
    return Number.parseInt(trimmed, 10);
};

const parseFloatValue = (value: string): number | null => {
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }
    const parsed = Number.parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
};

const parseJsonValue = (text: string): unknown => JSON.parse(text) as unknown;

export const parseVariableInitialValue = (
    valueKind: GraphVariableValueKind,
    scalarText: string,
    jsonText: string,
): unknown => {
    switch (valueKind) {
        case 'scalar.int': {
            const parsed = parseInteger(scalarText);
            if (parsed === null) {
                throw new Error('integer 初始值非法');
            }
            return parsed;
        }
        case 'scalar.float': {
            const parsed = parseFloatValue(scalarText);
            if (parsed === null) {
                throw new Error('float 初始值非法');
            }
            return parsed;
        }
        case 'scalar.string':
            return scalarText;
        case 'json.list': {
            const parsed = parseJsonValue(jsonText);
            if (!Array.isArray(parsed)) {
                throw new Error('json.list 初始值必须是数组');
            }
            return parsed;
        }
        case 'json.dict': {
            const parsed = parseJsonValue(jsonText);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new Error('json.dict 初始值必须是对象');
            }
            return parsed;
        }
        case 'json.any':
            return parseJsonValue(jsonText);
    }
};

export const formatVariableInitialValue = (
    variable: GraphVariableSpec | null,
): {scalar: string; json: string} => {
    if (!variable) {
        return {scalar: '', json: 'null'};
    }
    if (variable.value_kind === 'scalar.string') {
        return {
            scalar: typeof variable.initial_value === 'string' ? variable.initial_value : '',
            json: '" "',
        };
    }
    if (variable.value_kind === 'scalar.int' || variable.value_kind === 'scalar.float') {
        return {
            scalar:
                variable.initial_value === undefined || variable.initial_value === null
                    ? ''
                    : String(variable.initial_value),
            json: 'null',
        };
    }
    return {scalar: '', json: formatJsonValue(variable.initial_value)};
};

export const createDefaultVariableDraft = (): GraphVariableDraft => ({
    name: '',
    valueKind: 'scalar.int',
    scalarInitialValue: '0',
    jsonInitialValue: 'null',
});

export const summarizeVariableInitialValue = (variable: GraphVariableSpec): string => {
    if (variable.value_kind === 'scalar.string') {
        return String(variable.initial_value ?? '');
    }
    if (variable.value_kind === 'scalar.int' || variable.value_kind === 'scalar.float') {
        return String(variable.initial_value ?? '');
    }
    const text = JSON.stringify(variable.initial_value ?? null);
    if (text.length <= 36) {
        return text;
    }
    return `${text.slice(0, 33)}...`;
};
