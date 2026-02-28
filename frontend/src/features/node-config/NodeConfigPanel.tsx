import {useEffect, useMemo, useState, type CSSProperties} from 'react';

import {useGraphStore} from '../../shared/state/graph-store';

const panelStyle: CSSProperties = {
    marginTop: 10,
    border: '1px solid rgba(31, 41, 51, 0.14)',
    borderRadius: 10,
    padding: 10,
    background: 'rgba(255,255,255,0.86)',
};

const inputStyle: CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid rgba(31, 41, 51, 0.24)',
    borderRadius: 8,
    padding: '8px 10px',
    fontSize: 13,
    marginTop: 4,
};

const textareaStyle: CSSProperties = {
    ...inputStyle,
    minHeight: 130,
    resize: 'vertical',
    fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
    lineHeight: 1.4,
};

const buttonStyle: CSSProperties = {
    border: '1px solid rgba(31, 41, 51, 0.2)',
    borderRadius: 8,
    padding: '6px 10px',
    fontSize: 12,
    cursor: 'pointer',
    background: '#ffffff',
    marginRight: 8,
};

const formatJson = (value: Record<string, unknown>): string => JSON.stringify(value, null, 2);

export function NodeConfigPanel() {
    const selectedNodeId = useGraphStore((state) => state.selectedNodeId);
    const nodes = useGraphStore((state) => state.graph.nodes);
    const patchNode = useGraphStore((state) => state.patchNode);

    const selectedNode = useMemo(
        () => nodes.find((node) => node.node_id === selectedNodeId) ?? null,
        [nodes, selectedNodeId],
    );

    const [titleDraft, setTitleDraft] = useState('');
    const [configDraft, setConfigDraft] = useState('{}');
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    useEffect(() => {
        if (!selectedNode) {
            setTitleDraft('');
            setConfigDraft('{}');
            setErrorMessage(null);
            setSuccessMessage(null);
            return;
        }

        setTitleDraft(selectedNode.title);
        setConfigDraft(formatJson(selectedNode.config));
        setErrorMessage(null);
        setSuccessMessage(null);
    }, [selectedNode]);

    if (!selectedNode) {
        return (
            <section style={panelStyle} data-testid="node-config-empty">
                <h3 style={{marginTop: 0}}>Node Config</h3>
                <p style={{fontSize: 13, opacity: 0.82, marginBottom: 0}}>
                    Select a node on canvas to edit its title and config.
                </p>
            </section>
        );
    }

    const onSave = (): void => {
        const nextTitle = titleDraft.trim() || selectedNode.type_name;
        let parsedConfig: Record<string, unknown>;
        try {
            const rawParsed = JSON.parse(configDraft) as unknown;
            if (!rawParsed || typeof rawParsed !== 'object' || Array.isArray(rawParsed)) {
                setErrorMessage('Config must be a JSON object.');
                setSuccessMessage(null);
                return;
            }
            parsedConfig = rawParsed as Record<string, unknown>;
        } catch {
            setErrorMessage('Config JSON is invalid.');
            setSuccessMessage(null);
            return;
        }

        patchNode(selectedNode.node_id, {
            title: nextTitle,
            config: parsedConfig,
        });
        setErrorMessage(null);
        setSuccessMessage('Config saved.');
    };

    const onReset = (): void => {
        setTitleDraft(selectedNode.title);
        setConfigDraft(formatJson(selectedNode.config));
        setErrorMessage(null);
        setSuccessMessage(null);
    };

    return (
        <section style={panelStyle} data-testid="node-config-panel">
            <h3 style={{marginTop: 0, marginBottom: 6}}>Node Config</h3>
            <div style={{fontSize: 12, opacity: 0.78, marginBottom: 8}}>
                <div>node_id: {selectedNode.node_id}</div>
                <div>type_name: {selectedNode.type_name}</div>
            </div>

            <label style={{fontSize: 12}}>
                Title
                <input
                    value={titleDraft}
                    onChange={(event) => {
                        setTitleDraft(event.target.value);
                        setSuccessMessage(null);
                    }}
                    style={inputStyle}
                    data-testid="node-config-title-input"
                />
            </label>

            <label style={{display: 'block', fontSize: 12, marginTop: 10}}>
                Config JSON
                <textarea
                    value={configDraft}
                    onChange={(event) => {
                        setConfigDraft(event.target.value);
                        setSuccessMessage(null);
                    }}
                    style={textareaStyle}
                    data-testid="node-config-json-input"
                />
            </label>

            <div style={{marginTop: 10}}>
                <button type="button" style={buttonStyle} onClick={onSave}>
                    Save
                </button>
                <button type="button" style={buttonStyle} onClick={onReset}>
                    Reset
                </button>
            </div>

            {errorMessage && (
                <p style={{color: '#9f1239', fontSize: 12, marginBottom: 0}} data-testid="node-config-error">
                    {errorMessage}
                </p>
            )}
            {successMessage && !errorMessage && (
                <p style={{color: '#166534', fontSize: 12, marginBottom: 0}} data-testid="node-config-success">
                    {successMessage}
                </p>
            )}
        </section>
    );
}
