import {useState, type CSSProperties} from 'react';

import {apiClient, ApiClientError} from '../../shared/api/client';
import {useGraphStore} from '../../shared/state/graph-store';
import {useRunStore} from '../../shared/state/run-store';

const panelStyle: CSSProperties = {
    border: '1px solid rgba(31, 41, 51, 0.16)',
    borderRadius: 10,
    padding: 10,
    background: 'rgba(248, 250, 252, 0.95)',
    color: '#0f172a',
};

const buttonStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid rgba(31, 41, 51, 0.24)',
    borderRadius: 8,
    padding: '6px 10px',
    fontSize: 12,
    cursor: 'pointer',
    background: '#ffffff',
    color: '#0f172a',
    marginRight: 8,
    lineHeight: 1.1,
};

export function GraphValidationPanel() {
    const graph = useGraphStore((state) => state.graph);
    const validationValid = useGraphStore((state) => state.validationValid);
    const validationIssues = useGraphStore((state) => state.validationIssues);
    const validationCheckedAt = useGraphStore((state) => state.validationCheckedAt);
    const setValidationResult = useGraphStore((state) => state.setValidationResult);
    const clearValidation = useGraphStore((state) => state.clearValidation);

    const setStatus = useRunStore((state) => state.setStatus);
    const setError = useRunStore((state) => state.setError);

    const [isValidating, setIsValidating] = useState(false);

    const runValidation = async (): Promise<void> => {
        setIsValidating(true);
        setStatus('validating');
        setError(null);
        try {
            const report = await apiClient.validateGraph(graph);
            setValidationResult(report.valid, report.issues);
            setStatus('idle');
            if (!report.valid) {
                setError(`图校验失败，共 ${report.issues.length} 个问题`);
            }
        } catch (error) {
            const message = error instanceof ApiClientError ? error.message : String(error);
            setError(`图校验请求失败: ${message}`);
            setValidationResult(false, [
                {
                    level: 'error',
                    code: 'client.validation_request_failed',
                    message,
                },
            ]);
            setStatus('failed');
        } finally {
            setIsValidating(false);
        }
    };

    return (
        <section style={panelStyle} data-testid="graph-validation-panel">
            <h3 style={{marginTop: 0, marginBottom: 8}}>图校验</h3>
            <div style={{marginBottom: 8}}>
                <button
                    type="button"
                    style={buttonStyle}
                    onClick={() => {
                        void runValidation();
                    }}
                    disabled={isValidating}
                >
                    {isValidating ? '校验中...' : '校验图'}
                </button>
                <button
                    type="button"
                    style={buttonStyle}
                    onClick={() => clearValidation()}
                    disabled={isValidating || validationCheckedAt === null}
                >
                    清空
                </button>
            </div>

            {validationCheckedAt === null ? (
                <p style={{fontSize: 12, opacity: 0.8, margin: 0}} data-testid="validation-summary">
                    还未校验。
                </p>
            ) : (
                <div data-testid="validation-summary">
                    <p style={{fontSize: 12, marginTop: 0, marginBottom: 4}}>
                        结果: {validationValid ? '通过' : '未通过'} | 问题数: {validationIssues.length}
                    </p>
                    <p style={{fontSize: 12, marginTop: 0, opacity: 0.75}}>
                        校验时间: {new Date(validationCheckedAt).toLocaleTimeString()}
                    </p>
                </div>
            )}

            {validationIssues.length > 0 && (
                <ul style={{margin: 0, paddingLeft: 16, maxHeight: 140, overflow: 'auto'}}>
                    {validationIssues.map((issue, index) => (
                        <li key={`${issue.code}-${index}`} style={{fontSize: 12, marginBottom: 4}}>
                            <code>{issue.code}</code> - {issue.message}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
