import {useEffect, useState, type CSSProperties} from 'react';

import {apiClient, ApiClientError} from '../../shared/api/client';
import {useGraphStore} from '../../shared/state/graph-store';
import {useRunStore, type RunUiStatus} from '../../shared/state/run-store';

const panelStyle: CSSProperties = {
    border: '1px solid rgba(31, 41, 51, 0.16)',
    borderRadius: 10,
    padding: 10,
    background: 'rgba(255,255,255,0.86)',
};

const buttonStyle: CSSProperties = {
    border: '1px solid rgba(31, 41, 51, 0.24)',
    borderRadius: 8,
    padding: '6px 10px',
    fontSize: 12,
    cursor: 'pointer',
    background: '#ffffff',
    marginRight: 8,
};

const inputStyle: CSSProperties = {
    width: 220,
    boxSizing: 'border-box',
    border: '1px solid rgba(31, 41, 51, 0.24)',
    borderRadius: 8,
    padding: '6px 8px',
    fontSize: 12,
    marginRight: 8,
};

const mapBackendStatus = (status: string): RunUiStatus => {
    switch (status) {
        case 'running':
            return 'running';
        case 'stopped':
            return 'stopped';
        case 'completed':
            return 'completed';
        case 'failed':
            return 'failed';
        default:
            return 'idle';
    }
};

export function RunControlPanel() {
    const graph = useGraphStore((state) => state.graph);
    const runId = useRunStore((state) => state.runId);
    const status = useRunStore((state) => state.status);
    const isBusy = useRunStore((state) => state.isBusy);
    const lastError = useRunStore((state) => state.lastError);
    const attachRun = useRunStore((state) => state.attachRun);
    const setStatus = useRunStore((state) => state.setStatus);
    const setError = useRunStore((state) => state.setError);
    const clearRun = useRunStore((state) => state.clearRun);

    const [streamId, setStreamId] = useState('stream_frontend');
    const [requestBusy, setRequestBusy] = useState(false);

    useEffect(() => {
        if (!runId) {
            return;
        }
        let cancelled = false;
        const poll = async (): Promise<void> => {
            try {
                const snapshot = await apiClient.getRunStatus(runId);
                if (cancelled) {
                    return;
                }
                const mapped = mapBackendStatus(snapshot.status);
                setStatus(mapped);
                if (mapped !== 'running' && mapped !== 'validating') {
                    setError(snapshot.last_error);
                }
            } catch (error) {
                if (cancelled) {
                    return;
                }
                const message = error instanceof ApiClientError ? error.message : String(error);
                setStatus('failed');
                setError(`run status polling failed: ${message}`);
            }
        };

        void poll();
        const timer = window.setInterval(() => {
            void poll();
        }, 800);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [runId, setError, setStatus]);

    const startRun = async (): Promise<void> => {
        setRequestBusy(true);
        setStatus('validating');
        setError(null);
        try {
            const created = await apiClient.createRun({
                graph,
                stream_id: streamId,
            });
            attachRun(created.run_id, mapBackendStatus(created.status));
        } catch (error) {
            const message = error instanceof ApiClientError ? error.message : String(error);
            setStatus('failed');
            setError(`run create failed: ${message}`);
        } finally {
            setRequestBusy(false);
        }
    };

    const stopRun = async (): Promise<void> => {
        if (!runId) {
            return;
        }
        setRequestBusy(true);
        try {
            const stopped = await apiClient.stopRun(runId);
            setStatus(mapBackendStatus(stopped.status));
        } catch (error) {
            const message = error instanceof ApiClientError ? error.message : String(error);
            setStatus('failed');
            setError(`run stop failed: ${message}`);
        } finally {
            setRequestBusy(false);
        }
    };

    return (
        <section style={panelStyle} data-testid="run-control-panel">
            <h3 style={{marginTop: 0, marginBottom: 8}}>Run Control</h3>
            <div style={{marginBottom: 8}}>
                <input
                    value={streamId}
                    onChange={(event) => setStreamId(event.target.value)}
                    style={inputStyle}
                    aria-label="stream-id-input"
                />
                <button
                    type="button"
                    style={buttonStyle}
                    onClick={() => {
                        void startRun();
                    }}
                    disabled={requestBusy}
                >
                    Start Run
                </button>
                <button
                    type="button"
                    style={buttonStyle}
                    onClick={() => {
                        void stopRun();
                    }}
                    disabled={!runId || requestBusy}
                >
                    Stop Run
                </button>
                <button
                    type="button"
                    style={buttonStyle}
                    onClick={() => clearRun()}
                    disabled={requestBusy}
                >
                    Reset Run
                </button>
            </div>

            <div style={{fontSize: 12}} data-testid="run-control-summary">
                run_id={runId ?? 'none'} | status={status}
                {isBusy ? ' | busy' : ''}
            </div>
            {lastError && (
                <p style={{color: '#9f1239', fontSize: 12, marginBottom: 0}} data-testid="run-control-error">
                    {lastError}
                </p>
            )}
        </section>
    );
}
