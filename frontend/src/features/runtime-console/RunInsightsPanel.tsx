import {useCallback, useEffect, useRef, useState, type CSSProperties} from 'react';
import {useTranslation} from 'react-i18next';

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
    const {t} = useTranslation();
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
            setErrorMessage(t('runInsights.errors.loadFailed', {message}));
        } finally {
            if (isActiveRequest()) {
                setLoading(false);
            }
        }
    }, [runId, t]);

    useEffect(() => {
        void loadInsights();
    }, [loadInsights]);

    if (!runId) {
        return (
            <section style={panelStyle} data-testid="run-insights-empty">
                <h3 style={{marginTop: 0}}>{t('runInsights.title')}</h3>
                <p style={{marginBottom: 0, fontSize: 13, opacity: 0.82}}>
                    {t('runInsights.emptyPrompt')}
                </p>
            </section>
        );
    }

    return (
        <section style={panelStyle} data-testid="run-insights-panel">
            <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8}}>
                <h3 style={{margin: 0}}>{t('runInsights.title')}</h3>
                <button type="button" style={buttonStyle} onClick={() => void loadInsights()} disabled={loading}>
                    {loading ? t('runInsights.actions.refreshing') : t('runInsights.actions.refresh')}
                </button>
            </div>

            {errorMessage && (
                <p style={{color: '#9f1239', fontSize: 12, marginTop: 8}} data-testid="run-insights-error">
                    {errorMessage}
                </p>
            )}

            {!errorMessage && metrics && (
                <div style={{fontSize: 12, marginTop: 8}} data-testid="run-insights-metrics">
                    <div>{t('runInsights.metrics.status', {status: metrics.status})}</div>
                    <div>{t('runInsights.metrics.graphKeyCount', {count: Object.keys(metrics.graph_metrics).length})}</div>
                    <div>{t('runInsights.metrics.nodeCount', {count: Object.keys(metrics.node_metrics).length})}</div>
                    <div>{t('runInsights.metrics.edgeCount', {count: metrics.edge_metrics.length})}</div>
                </div>
            )}

            {!errorMessage && diagnostics && (
                <div style={{fontSize: 12, marginTop: 8}} data-testid="run-insights-diagnostics">
                    <div>{t('runInsights.diagnostics.failedNodes', {count: diagnostics.failed_nodes.length})}</div>
                    <div>{t('runInsights.diagnostics.slowNodesTop', {count: diagnostics.slow_nodes_top.length})}</div>
                    <div>{t('runInsights.diagnostics.edgeHotspotsTop', {count: diagnostics.edge_hotspots_top.length})}</div>
                </div>
            )}
        </section>
    );
}
