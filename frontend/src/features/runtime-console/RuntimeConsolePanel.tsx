import {useCallback, useEffect, useMemo, useRef, useState, type CSSProperties} from 'react';
import {useTranslation} from 'react-i18next';

import type {
    RuntimeEvent,
    RuntimeEventSeverity,
    RuntimeEventType,
} from '../../entities/workbench/types';
import {apiClient} from '../../shared/api/client';
import {useRunStore} from '../../shared/state/run-store';
import {useRuntimeConsoleStore} from '../../shared/state/console-store';

const panelStyle: CSSProperties = {
    border: '1px solid rgba(31, 41, 51, 0.16)',
    borderRadius: 10,
    padding: 10,
    background: 'rgba(248, 250, 252, 0.95)',
    color: '#0f172a',
};

const inputStyle: CSSProperties = {
    border: '1px solid rgba(31, 41, 51, 0.22)',
    borderRadius: 8,
    padding: '6px 8px',
    fontSize: 12,
    marginRight: 8,
    marginBottom: 8,
    color: '#0f172a',
    background: '#ffffff',
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
    marginBottom: 8,
    lineHeight: 1.1,
};

const isRuntimeEvent = (payload: unknown): payload is RuntimeEvent => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return false;
    }
    const data = payload as Record<string, unknown>;
    return (
        typeof data.run_id === 'string' &&
        typeof data.event_id === 'string' &&
        typeof data.event_seq === 'number' &&
        typeof data.event_type === 'string'
    );
};

const eventTypes: RuntimeEventType[] = [
    'run_started',
    'run_stopped',
    'node_started',
    'node_finished',
    'node_retry',
    'node_timeout',
    'node_failed',
    'frame_emitted',
    'sync_frame_emitted',
];

const severities: RuntimeEventSeverity[] = ['debug', 'info', 'warning', 'error', 'critical'];

export function RuntimeConsolePanel() {
    const {t} = useTranslation();
    const runId = useRunStore((state) => state.runId);
    const events = useRuntimeConsoleStore((state) => state.events);
    const filters = useRuntimeConsoleStore((state) => state.filters);
    const lastCursor = useRuntimeConsoleStore((state) => state.lastCursor);
    const appendEvents = useRuntimeConsoleStore((state) => state.appendEvents);
    const setCursor = useRuntimeConsoleStore((state) => state.setCursor);
    const setFilters = useRuntimeConsoleStore((state) => state.setFilters);
    const clearEvents = useRuntimeConsoleStore((state) => state.clearEvents);

    const wsRef = useRef<WebSocket | null>(null);
    const prevRunIdRef = useRef<string | null>(runId);
    const [isLoading, setIsLoading] = useState(false);
    const [wsConnected, setWsConnected] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const latestEvents = useMemo(() => events.slice(-30).reverse(), [events]);

    const closeWs = useCallback(() => {
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }
        setWsConnected(false);
    }, []);

    useEffect(() => {
        return () => {
            closeWs();
        };
    }, [closeWs]);

    useEffect(() => {
        const prevRunId = prevRunIdRef.current;
        if (prevRunId === runId) {
            return;
        }

        prevRunIdRef.current = runId;
        closeWs();
        clearEvents();
        setErrorMessage(null);
        setIsLoading(false);
    }, [runId, closeWs, clearEvents]);

    const loadEvents = async (): Promise<void> => {
        if (!runId) {
            return;
        }
        setIsLoading(true);
        setErrorMessage(null);
        try {
            const payload = await apiClient.getRunEvents(runId, {
                since: lastCursor,
                limit: 200,
                event_type: filters.event_type,
                node_id: filters.node_id,
                severity: filters.severity,
                error_code: filters.error_code,
            });
            appendEvents(payload.items);
            setCursor(payload.next_cursor);
        } catch (error) {
            setErrorMessage(t('runtimeConsole.errors.loadEventsFailed', {message: String(error)}));
        } finally {
            setIsLoading(false);
        }
    };

    const subscribeWs = (): void => {
        if (!runId || wsRef.current) {
            return;
        }
        setErrorMessage(null);
        const url = apiClient.buildRunEventsWsUrl(runId, {
            since: lastCursor,
            event_type: filters.event_type,
            node_id: filters.node_id,
            severity: filters.severity,
            error_code: filters.error_code,
        });
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
            setWsConnected(true);
        };
        ws.onerror = () => {
            setErrorMessage(t('runtimeConsole.errors.wsConnectFailed'));
        };
        ws.onclose = () => {
            setWsConnected(false);
            wsRef.current = null;
        };
        ws.onmessage = (event) => {
            try {
                const payload = JSON.parse(event.data as string) as unknown;
                if (!isRuntimeEvent(payload)) {
                    return;
                }
                appendEvents([payload]);
                setCursor(payload.event_seq + 1);
            } catch {
                setErrorMessage(t('runtimeConsole.errors.wsParseFailed'));
            }
        };
    };

    return (
        <section style={panelStyle} data-testid="runtime-console-panel">
            <h3 style={{marginTop: 0, marginBottom: 8}}>{t('runtimeConsole.title')}</h3>
            <div style={{fontSize: 12, marginBottom: 8}} data-testid="runtime-console-summary">
                {t('runtimeConsole.summary', {
                    runId: runId ?? t('common.none'),
                    cursor: lastCursor,
                    wsState: wsConnected ? t('runtimeConsole.ws.connected') : t('runtimeConsole.ws.idle'),
                    count: events.length,
                })}
            </div>

            <div>
                <select
                    value={filters.event_type ?? ''}
                    onChange={(event) =>
                        setFilters({
                            event_type: (event.target.value || undefined) as RuntimeEventType | undefined,
                        })
                    }
                    style={inputStyle}
                    aria-label="filter-event-type"
                >
                    <option value="">{t('runtimeConsole.filters.eventTypeAll')}</option>
                    {eventTypes.map((value) => (
                        <option key={value} value={value}>
                            {value}
                        </option>
                    ))}
                </select>
                <select
                    value={filters.severity ?? ''}
                    onChange={(event) =>
                        setFilters({
                            severity: (event.target.value || undefined) as RuntimeEventSeverity | undefined,
                        })
                    }
                    style={inputStyle}
                    aria-label="filter-severity"
                >
                    <option value="">{t('runtimeConsole.filters.severityAll')}</option>
                    {severities.map((value) => (
                        <option key={value} value={value}>
                            {value}
                        </option>
                    ))}
                </select>
                <input
                    value={filters.node_id ?? ''}
                    onChange={(event) => setFilters({node_id: event.target.value || undefined})}
                    style={inputStyle}
                    placeholder={t('runtimeConsole.filters.nodeIdPlaceholder')}
                    aria-label="filter-node-id"
                />
                <input
                    value={filters.error_code ?? ''}
                    onChange={(event) => setFilters({error_code: event.target.value || undefined})}
                    style={inputStyle}
                    placeholder={t('runtimeConsole.filters.errorCodePlaceholder')}
                    aria-label="filter-error-code"
                />
            </div>

            <div>
                <button
                    type="button"
                    style={buttonStyle}
                    onClick={() => {
                        void loadEvents();
                    }}
                    disabled={!runId || isLoading}
                >
                    {isLoading ? t('runtimeConsole.actions.loadingEvents') : t('runtimeConsole.actions.loadEvents')}
                </button>
                <button
                    type="button"
                    style={buttonStyle}
                    onClick={subscribeWs}
                    disabled={!runId || wsConnected}
                >
                    {t('runtimeConsole.actions.subscribeWs')}
                </button>
                <button
                    type="button"
                    style={buttonStyle}
                    onClick={closeWs}
                    disabled={!wsConnected}
                >
                    {t('runtimeConsole.actions.unsubscribeWs')}
                </button>
                <button
                    type="button"
                    style={buttonStyle}
                    onClick={() => clearEvents()}
                    disabled={events.length === 0}
                >
                    {t('runtimeConsole.actions.clearEvents')}
                </button>
            </div>

            {errorMessage && (
                <p style={{color: '#9f1239', fontSize: 12, margin: '4px 0 8px'}} data-testid="runtime-console-error">
                    {errorMessage}
                </p>
            )}

            <div
                style={{
                    border: '1px solid rgba(31, 41, 51, 0.14)',
                    borderRadius: 8,
                    maxHeight: 160,
                    overflow: 'auto',
                    fontSize: 12,
                    padding: 8,
                }}
            >
                {latestEvents.length === 0 ? (
                    <div data-testid="runtime-console-empty" style={{opacity: 0.72}}>
                        {t('runtimeConsole.empty')}
                    </div>
                ) : (
                    latestEvents.map((event) => (
                        <div
                            key={event.event_id}
                            style={{marginBottom: 6, paddingBottom: 6, borderBottom: '1px solid rgba(31, 41, 51, 0.1)'}}
                        >
                            <code>#{event.event_seq}</code> [{event.severity}] {event.event_type}
                            {event.node_id ? ` @${event.node_id}` : ''}
                        </div>
                    ))
                )}
            </div>
        </section>
    );
}
