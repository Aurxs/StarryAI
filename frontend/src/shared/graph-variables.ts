import type {GraphVariableSpec, GraphVariableValueKind} from '../entities/workbench/types';

export interface GraphVariableDraft {
    name: string;
    isConstant: boolean;
    valueKind: GraphVariableValueKind;
    scalarInitialValue: string;
    jsonInitialValue: string;
}

export interface GraphVariableParseMessages {
    invalidIntegerInitialValue?: string;
    invalidFloatInitialValue?: string;
    invalidJsonInitialValue?: string;
    listInitialValueMustBeArray?: string;
    dictInitialValueMustBeObject?: string;
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

const parseJsonValue = (text: string, invalidMessage?: string): unknown => {
    try {
        return JSON.parse(text) as unknown;
    } catch {
        throw new Error(invalidMessage ?? 'Invalid JSON initial value');
    }
};

export const parseVariableInitialValue = (
    valueKind: GraphVariableValueKind,
    scalarText: string,
    jsonText: string,
    messages: GraphVariableParseMessages = {},
): unknown => {
    switch (valueKind) {
        case 'scalar.int': {
            const parsed = parseInteger(scalarText);
            if (parsed === null) {
                throw new Error(messages.invalidIntegerInitialValue ?? 'Invalid integer initial value');
            }
            return parsed;
        }
        case 'scalar.float': {
            const parsed = parseFloatValue(scalarText);
            if (parsed === null) {
                throw new Error(messages.invalidFloatInitialValue ?? 'Invalid float initial value');
            }
            return parsed;
        }
        case 'scalar.string':
            return scalarText;
        case 'json.list': {
            const parsed = parseJsonValue(jsonText, messages.invalidJsonInitialValue);
            if (!Array.isArray(parsed)) {
                throw new Error(messages.listInitialValueMustBeArray ?? 'JSON list initial value must be an array');
            }
            return parsed;
        }
        case 'json.dict': {
            const parsed = parseJsonValue(jsonText, messages.invalidJsonInitialValue);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new Error(messages.dictInitialValueMustBeObject ?? 'JSON dict initial value must be an object');
            }
            return parsed;
        }
        case 'json.any':
            return parseJsonValue(jsonText, messages.invalidJsonInitialValue);
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
    isConstant: false,
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
