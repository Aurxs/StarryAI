import {useEffect, useMemo, useRef, useState, type CSSProperties} from 'react';
import {useTranslation} from 'react-i18next';

import {GraphEditor} from '../../features/graph-editor/GraphEditor';
import {NodeConfigPanel} from '../../features/node-config/NodeConfigPanel';
import {apiClient, ApiClientError} from '../../shared/api/client';
import {
    changeAppLanguage,
    getCurrentLanguage,
    supportedLanguages,
    type SupportedLanguage,
} from '../../shared/i18n/i18n';
import {translateRunStatus} from '../../shared/i18n/label-mappers';
import {isRunActiveStatus, isRunTerminalStatus, mapBackendRunStatus} from '../../shared/run-status';
import {useGraphStore} from '../../shared/state/graph-store';
import {useRunStore} from '../../shared/state/run-store';
import {useUiStore} from '../../shared/state/ui-store';

const shellStyle: CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '100dvh',
    overflow: 'hidden',
    color: '#0f172a',
    fontFamily: '"Avenir Next", "Segoe UI", sans-serif',
    background: '#f4f6fb',
};

const surfaceStyle: CSSProperties = {
    border: '1px solid #dce3ee',
    borderRadius: 12,
    background: 'rgba(255, 255, 255, 0.95)',
    boxShadow: '0 10px 24px rgba(15, 23, 42, 0.08)',
};

const floatingButtonStyle: CSSProperties = {
    border: '1px solid #d5dff0',
    borderRadius: 8,
    background: '#fff',
    padding: '6px 10px',
    cursor: 'pointer',
    fontSize: 12,
    color: '#334155',
};

const historyTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
});
const INSPECTOR_TRANSITION_MS = 220;
const INSPECTOR_DOCK_WIDTH = 352;
const NON_LINEAR_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const IGNORED_REVIEW_ISSUE_CODES = new Set(['graph.empty_nodes']);

export function WorkbenchPage() {
    const {t} = useTranslation();

    const graph = useGraphStore((state) => state.graph);
    const isDirty = useGraphStore((state) => state.isDirty);
    const selectedNodeId = useGraphStore((state) => state.selectedNodeId);
    const validationIssues = useGraphStore((state) => state.validationIssues);
    const validationCheckedAt = useGraphStore((state) => state.validationCheckedAt);
    const canUndo = useGraphStore((state) => state.canUndo);
    const canRedo = useGraphStore((state) => state.canRedo);
    const historyEntries = useGraphStore((state) => state.historyEntries);
    const undo = useGraphStore((state) => state.undo);
    const redo = useGraphStore((state) => state.redo);
    const selectNode = useGraphStore((state) => state.selectNode);
    const setValidationResult = useGraphStore((state) => state.setValidationResult);

    const runId = useRunStore((state) => state.runId);
    const runStatus = useRunStore((state) => state.status);
    const isRunBusy = useRunStore((state) => state.isBusy);
    const runError = useRunStore((state) => state.lastError);
    const setRunStatus = useRunStore((state) => state.setStatus);
    const setRunError = useRunStore((state) => state.setError);
    const attachRun = useRunStore((state) => state.attachRun);

    const reviewDrawerOpen = useUiStore((state) => state.reviewDrawerOpen);
    const historyDrawerOpen = useUiStore((state) => state.historyDrawerOpen);
    const setReviewDrawerOpen = useUiStore((state) => state.setReviewDrawerOpen);
    const setHistoryDrawerOpen = useUiStore((state) => state.setHistoryDrawerOpen);
    const setEditorMode = useUiStore((state) => state.setEditorMode);
    const setNodeLibraryOpen = useUiStore((state) => state.setNodeLibraryOpen);
    const setZoomMenuOpen = useUiStore((state) => state.setZoomMenuOpen);

    const [activeLanguage, setActiveLanguage] = useState<SupportedLanguage>(() => getCurrentLanguage());
    const [activeProject, setActiveProject] = useState('当前项目名称');
    const [projectMenuOpen, setProjectMenuOpen] = useState(false);
    const [isReviewing, setIsReviewing] = useState(false);
    const [isInspectorMounted, setIsInspectorMounted] = useState(selectedNodeId !== null);
    const [isInspectorActive, setIsInspectorActive] = useState(selectedNodeId !== null);
    const reviewRequestIdRef = useRef(0);
    const previousSelectedNodeIdRef = useRef<string | null>(selectedNodeId);
    const hasNodes = graph.nodes.length > 0;

    const reviewIssues = useMemo(
        () => validationIssues.filter((issue) => !IGNORED_REVIEW_ISSUE_CODES.has(issue.code)),
        [validationIssues],
    );

    const issueSummary = useMemo(() => {
        const errorCount = reviewIssues.filter((issue) => issue.level === 'error').length;
        const warningCount = reviewIssues.filter((issue) => issue.level === 'warning').length;
        return {
            errorCount,
            warningCount,
        };
    }, [reviewIssues]);

    const canRun = hasNodes && validationCheckedAt !== null && issueSummary.errorCount === 0 && !isReviewing && !isRunBusy;
    const inspectorShift = selectedNodeId ? INSPECTOR_DOCK_WIDTH : 0;
    const bottomShift = inspectorShift / 2;
    const reviewGlow = issueSummary.errorCount > 0
        ? '0 0 14px rgba(220, 38, 38, 0.42), 0 10px 22px rgba(220, 38, 38, 0.32)'
        : '0 0 14px rgba(22, 163, 74, 0.5), 0 10px 22px rgba(22, 163, 74, 0.34)';

    useEffect(() => {
        setEditorMode('hand');
    }, [setEditorMode]);

    useEffect(() => {
        let unmountTimer: number | null = null;
        let activateFrameA: number | null = null;
        let activateFrameB: number | null = null;
        const wasInspectorOpen = previousSelectedNodeIdRef.current !== null;
        if (selectedNodeId) {
            setIsInspectorMounted(true);
            if (!wasInspectorOpen) {
                setIsInspectorActive(false);
                activateFrameA = window.requestAnimationFrame(() => {
                    activateFrameB = window.requestAnimationFrame(() => {
                        setIsInspectorActive(true);
                    });
                });
            } else {
                setIsInspectorActive(true);
            }
        } else {
            setIsInspectorActive(false);
            unmountTimer = window.setTimeout(() => {
                setIsInspectorMounted(false);
            }, INSPECTOR_TRANSITION_MS);
        }
        previousSelectedNodeIdRef.current = selectedNodeId;
        return () => {
            if (activateFrameA !== null) {
                window.cancelAnimationFrame(activateFrameA);
            }
            if (activateFrameB !== null) {
                window.cancelAnimationFrame(activateFrameB);
            }
            if (unmountTimer !== null) {
                window.clearTimeout(unmountTimer);
            }
        };
    }, [selectedNodeId]);

    useEffect(() => {
        if (!isDirty) {
            return;
        }
        reviewRequestIdRef.current += 1;
        const requestId = reviewRequestIdRef.current;
        const timer = window.setTimeout(async () => {
            setIsReviewing(true);
            try {
                const report = await apiClient.validateGraph(graph);
                if (requestId !== reviewRequestIdRef.current) {
                    return;
                }
                setValidationResult(report.valid, report.issues);
            } catch (error) {
                if (requestId !== reviewRequestIdRef.current) {
                    return;
                }
                const message = error instanceof ApiClientError ? error.message : String(error);
                setValidationResult(false, [
                    {
                        level: 'error',
                        code: 'client.validation_request_failed',
                        message,
                    },
                ]);
            } finally {
                if (requestId === reviewRequestIdRef.current) {
                    setIsReviewing(false);
                }
            }
        }, 500);
        return () => {
            window.clearTimeout(timer);
        };
    }, [graph, isDirty, setValidationResult]);

    useEffect(() => {
        if (!runId) {
            return;
        }
        let cancelled = false;
        let timer: number | null = null;
        const scheduleNextPoll = () => {
            if (cancelled) {
                return;
            }
            timer = window.setTimeout(() => {
                void poll();
            }, 900);
        };
        const poll = async (): Promise<void> => {
            try {
                const snapshot = await apiClient.getRunStatus(runId);
                if (cancelled) {
                    return;
                }
                const mapped = mapBackendRunStatus(snapshot.status);
                setRunStatus(mapped);
                if (mapped !== 'running' && mapped !== 'validating') {
                    setRunError(snapshot.last_error);
                }
                if (!isRunTerminalStatus(mapped)) {
                    scheduleNextPoll();
                }
            } catch (error) {
                if (cancelled) {
                    return;
                }
                const message = error instanceof ApiClientError ? error.message : String(error);
                setRunStatus('failed');
                setRunError(t('runControl.errors.pollFailed', {message}));
            }
        };
        void poll();
        return () => {
            cancelled = true;
            if (timer !== null) {
                window.clearTimeout(timer);
            }
        };
    }, [runId, setRunError, setRunStatus, t]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            const commandPressed = event.metaKey || event.ctrlKey;
            if (!commandPressed) {
                return;
            }
            const key = event.key.toLowerCase();
            if (key !== 'z') {
                return;
            }
            event.preventDefault();
            if (event.shiftKey) {
                redo();
                return;
            }
            undo();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [redo, undo]);

    const runReviewText = (): string => {
        if (isReviewing) {
            return t('workbench.review.rechecking');
        }
        if (issueSummary.errorCount > 0) {
            return t('workbench.review.errorCount', {count: issueSummary.errorCount});
        }
        if (issueSummary.warningCount > 0) {
            return t('workbench.review.warningCount', {count: issueSummary.warningCount});
        }
        return t('workbench.review.ok');
    };

    const runButtonText = (): string => {
        if (isRunBusy || isRunActiveStatus(runStatus)) {
            return t('workbench.run.running');
        }
        return t('workbench.run.start');
    };

    const startRun = async (): Promise<void> => {
        if (!canRun) {
            return;
        }
        setRunStatus('validating');
        setRunError(null);
        try {
            const created = await apiClient.createRun({
                graph,
                stream_id: 'stream_frontend',
            });
            attachRun(created.run_id, mapBackendRunStatus(created.status));
        } catch (error) {
            const message = error instanceof ApiClientError ? error.message : String(error);
            setRunStatus('failed');
            setRunError(t('runControl.errors.startFailed', {message}));
        }
    };

    return (
        <main style={shellStyle}>
            <section style={{position: 'absolute', inset: 0, zIndex: 0}}>
                <GraphEditor/>
            </section>

            <header
                style={{
                    ...surfaceStyle,
                    position: 'absolute',
                    left: 10,
                    top: 10,
                    zIndex: 10,
                    padding: 10,
                }}
            >
                <button
                    type="button"
                    style={{...floatingButtonStyle, padding: '4px 8px'}}
                    onClick={() => {
                        setProjectMenuOpen(!projectMenuOpen);
                        setZoomMenuOpen(false);
                    }}
                >
                    {activeProject} ↓
                </button>
                {projectMenuOpen && (
                    <div style={{marginTop: 8, display: 'grid', gap: 6}}>
                        {['当前项目名称', '演示项目 A', '演示项目 B'].map((project) => (
                            <button
                                key={project}
                                type="button"
                                style={{
                                    ...floatingButtonStyle,
                                    padding: '4px 8px',
                                    background: activeProject === project ? '#e2f7ec' : '#fff',
                                }}
                                onClick={() => {
                                    setActiveProject(project);
                                    setProjectMenuOpen(false);
                                }}
                            >
                                {project}
                            </button>
                        ))}
                        <div style={{fontSize: 12, marginTop: 4}}>
                            <label htmlFor="language-switch">{t('language.label')}：</label>
                            <select
                                id="language-switch"
                                data-testid="language-switch"
                                value={activeLanguage}
                                style={{marginLeft: 6}}
                                onChange={(event) => {
                                    const nextLanguage = event.target.value as SupportedLanguage;
                                    setActiveLanguage(nextLanguage);
                                    void changeAppLanguage(nextLanguage);
                                }}
                            >
                                {supportedLanguages.map((language) => (
                                    <option key={language} value={language}>
                                        {t(`language.${language}`)}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                )}
            </header>

            <section
                style={{
                    ...surfaceStyle,
                    position: 'absolute',
                    right: 10 + inspectorShift,
                    top: 10,
                    zIndex: 10,
                    padding: 10,
                    minWidth: 192,
                    transition: `right 180ms ${NON_LINEAR_EASE}`,
                }}
            >
                <button
                    type="button"
                    onClick={() => {
                        void startRun();
                    }}
                    disabled={!canRun}
                    style={{
                        ...floatingButtonStyle,
                        width: '100%',
                        height: 38,
                        borderColor: canRun ? '#1d4ed8' : '#d5dff0',
                        background: canRun ? '#2563eb' : '#f8fafc',
                        color: canRun ? '#ffffff' : '#94a3b8',
                        fontWeight: 700,
                    }}
                >
                    ▶ {runButtonText()}
                </button>
                <div style={{fontSize: 12, marginTop: 6}}>
                    {t('workbench.summary.runStatus', {
                        status: translateRunStatus(t, runStatus),
                        busySuffix: isRunBusy ? t('workbench.busySuffix') : '',
                    })}
                </div>
                {runError && (
                    <div style={{fontSize: 12, color: '#b91c1c', marginTop: 4}} data-testid="run-action-error">
                        {runError}
                    </div>
                )}
            </section>

            <section
                    style={{
                        ...surfaceStyle,
                    position: 'absolute',
                    left: 12,
                    bottom: 12,
                    zIndex: 10,
                    minHeight: 44,
                    padding: 6,
                    display: 'flex',
                    gap: 6,
                    alignItems: 'center',
                }}
            >
                <button type="button" style={{...floatingButtonStyle, width: 32, height: 32, padding: 0}} onClick={() => undo()} disabled={!canUndo}>
                    ↶
                </button>
                <button type="button" style={{...floatingButtonStyle, width: 32, height: 32, padding: 0}} onClick={() => redo()} disabled={!canRedo}>
                    ↷
                </button>
                <button
                    type="button"
                    style={{...floatingButtonStyle, width: 32, height: 32, padding: 0}}
                    onClick={() => {
                        setHistoryDrawerOpen(!historyDrawerOpen);
                        setReviewDrawerOpen(false);
                    }}
                >
                    ⏱
                </button>
                {historyDrawerOpen && (
                    <aside
                        aria-label="history-drawer"
                    style={{
                        ...surfaceStyle,
                        position: 'absolute',
                        left: 0,
                        bottom: 50,
                        width: 320,
                        maxHeight: 280,
                            overflow: 'auto',
                            padding: 10,
                        }}
                    >
                        <h3 style={{marginTop: 0, marginBottom: 6}}>{t('workbench.history.title')}</h3>
                        {historyEntries.length === 0 ? (
                            <div style={{fontSize: 12}}>{t('workbench.history.empty')}</div>
                        ) : (
                            <ul style={{margin: 0, paddingLeft: 16}}>
                                {[...historyEntries].reverse().map((entry) => (
                                    <li key={entry.id} style={{fontSize: 12, marginBottom: 4}}>
                                        {historyTimeFormatter.format(entry.at)} - {entry.label}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </aside>
                )}
            </section>

            <section
                style={{
                    position: 'absolute',
                    left: `calc(50% - ${bottomShift}px)`,
                    transform: 'translateX(-50%)',
                    bottom: 12,
                    zIndex: 10,
                    transition: `left 180ms ${NON_LINEAR_EASE}`,
                }}
            >
                <button
                    type="button"
                    style={{
                        ...floatingButtonStyle,
                        minWidth: 178,
                        minHeight: 44,
                        borderRadius: 12,
                        borderColor: '#d5dff0',
                        boxShadow: reviewGlow,
                        color: '#334155',
                        fontWeight: 700,
                    }}
                    data-testid="review-bar"
                    onClick={() => {
                        setReviewDrawerOpen(!reviewDrawerOpen);
                        setHistoryDrawerOpen(false);
                    }}
                >
                    {runReviewText()}
                </button>
                {reviewDrawerOpen && (
                    <aside
                        aria-label="review-drawer"
                        style={{
                        ...surfaceStyle,
                        position: 'absolute',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        bottom: 52,
                        width: 420,
                            maxHeight: 300,
                            overflow: 'auto',
                            padding: 10,
                        }}
                    >
                        <h3 style={{marginTop: 0, marginBottom: 8}}>{t('workbench.review.title')}</h3>
                        {reviewIssues.length === 0 ? (
                            <div style={{fontSize: 12}}>{t('workbench.review.ok')}</div>
                        ) : (
                            <ul style={{margin: 0, paddingLeft: 16}}>
                                {reviewIssues.map((issue, index) => (
                                    <li key={`${issue.code}-${index}`} style={{marginBottom: 6}}>
                                        <code>{issue.code}</code> - {issue.message}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </aside>
                )}
            </section>

            {isInspectorMounted && (
                <aside
                    aria-label="node-inspector-drawer"
                    style={{
                        ...surfaceStyle,
                        position: 'absolute',
                        right: 0,
                        top: 0,
                        bottom: 0,
                        width: 340,
                        zIndex: 12,
                        borderRadius: 0,
                        borderLeft: '1px solid rgba(148, 163, 184, 0.45)',
                        padding: 10,
                        overflow: 'auto',
                        transform: isInspectorActive ? 'translateX(0)' : 'translateX(100%)',
                        opacity: isInspectorActive ? 1 : 0,
                        transition: `transform ${INSPECTOR_TRANSITION_MS}ms ${NON_LINEAR_EASE}, opacity ${INSPECTOR_TRANSITION_MS}ms ${NON_LINEAR_EASE}`,
                        pointerEvents: isInspectorActive ? 'auto' : 'none',
                    }}
                >
                    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                        <h2 style={{margin: 0}}>{t('workbench.inspector.title')}</h2>
                        <button
                            type="button"
                            style={floatingButtonStyle}
                            onClick={() => {
                                selectNode(null);
                                setNodeLibraryOpen(false);
                            }}
                        >
                            ×
                        </button>
                    </div>
                    <NodeConfigPanel/>
                </aside>
            )}
        </main>
    );
}
