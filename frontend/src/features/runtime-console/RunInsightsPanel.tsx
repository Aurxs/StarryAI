import {useCallback, useEffect, useRef, useState, type CSSProperties} from 'react';

import type {RunDiagnosticsResponse, RunMetricsResponse} from '../../entities/workbench/types';
import {apiClient, ApiClientError} from '../../shared/api/client';
import {useRunStore} from '../../shared/state/run-store';

const panelStyle: CSSProperties = {
    border: '1px solid rgba(31, 41, 51, 0.16)',
    borderRadius: 10,
    padding: 10,
    background: 'rgba(248, 250, 252, 0.95)',
    color: '#0f172a',
    marginTop: 10,
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
    lineHeight: 1.1,
};

export function RunInsightsPanel() {
    const runId = useRunStore((state) => state.runId);
    const requestSeqRef = useRef(0);

    const [loading, setLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [metrics, setMetrics] = useState<RunMetricsResponse | null>(null);
    const [diagnostics, setDiagnostics] = useState<RunDiagnosticsResponse | null>(null);

    const loadInsights = useCallback(async () => {
        const targetRunId = runId;
        if (!targetRunId) {
            requestSeqRef.current += 1;
            setLoading(false);
            setErrorMessage(null);
            setMetrics(null);
            setDiagnostics(null);
            return;
        }
        const requestSeq = requestSeqRef.current + 1;
        requestSeqRef.current = requestSeq;
        const isActiveRequest = (): boolean =>
            requestSeqRef.current === requestSeq && useRunStore.getState().runId === targetRunId;
        setLoading(true);
        setErrorMessage(null);
        try {
            const [metricsPayload, diagnosticsPayload] = await Promise.all([
                apiClient.getRunMetrics(targetRunId),
                apiClient.getRunDiagnostics(targetRunId),
            ]);
            if (!isActiveRequest()) {
                return;
            }
            setMetrics(metricsPayload);
            setDiagnostics(diagnosticsPayload);
        } catch (error) {
            if (!isActiveRequest()) {
                return;
            }
            const message = error instanceof ApiClientError ? error.message : String(error);
            setErrorMessage(`加载运行洞察失败: ${message}`);
        } finally {
            if (isActiveRequest()) {
                setLoading(false);
            }
        }
    }, [runId]);

    useEffect(() => {
        void loadInsights();
    }, [loadInsights]);

    if (!runId) {
        return (
            <section style={panelStyle} data-testid="run-insights-empty">
                <h3 style={{marginTop: 0}}>运行洞察</h3>
                <p style={{marginBottom: 0, fontSize: 13, opacity: 0.82}}>
                    启动一次运行后即可查看指标与诊断信息。
                </p>
            </section>
        );
    }

    return (
        <section style={panelStyle} data-testid="run-insights-panel">
            <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8}}>
                <h3 style={{margin: 0}}>运行洞察</h3>
                <button type="button" style={buttonStyle} onClick={() => void loadInsights()} disabled={loading}>
                    {loading ? '刷新中...' : '刷新'}
                </button>
            </div>

            {errorMessage && (
                <p style={{color: '#9f1239', fontSize: 12, marginTop: 8}} data-testid="run-insights-error">
                    {errorMessage}
                </p>
            )}

            {!errorMessage && metrics && (
                <div style={{fontSize: 12, marginTop: 8}} data-testid="run-insights-metrics">
                    <div>状态: {metrics.status}</div>
                    <div>图指标键数量: {Object.keys(metrics.graph_metrics).length}</div>
                    <div>节点指标数量: {Object.keys(metrics.node_metrics).length}</div>
                    <div>边指标数量: {metrics.edge_metrics.length}</div>
                </div>
            )}

            {!errorMessage && diagnostics && (
                <div style={{fontSize: 12, marginTop: 8}} data-testid="run-insights-diagnostics">
                    <div>失败节点数: {diagnostics.failed_nodes.length}</div>
                    <div>慢节点 Top 数: {diagnostics.slow_nodes_top.length}</div>
                    <div>热点边 Top 数: {diagnostics.edge_hotspots_top.length}</div>
                </div>
            )}
        </section>
    );
}
