import {useEffect, useMemo, useRef, useState, type CSSProperties} from 'react';
import {History, Play, Redo2, Undo2, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';

import type {GraphSummary} from '../../entities/workbench/types';
import {GraphEditor} from '../../features/graph-editor/GraphEditor';
import {NodeConfigPanel} from '../../features/node-config/NodeConfigPanel';
import {apiClient, ApiClientError} from '../../shared/api/client';
import {translateRunStatus} from '../../shared/i18n/label-mappers';
import {isRunActiveStatus, isRunTerminalStatus, mapBackendRunStatus} from '../../shared/run-status';
import {clearGlobalInfoMessage, pushGlobalInfoMessage} from '../../shared/state/global-info-store';
import {useGraphStore} from '../../shared/state/graph-store';
import {useRunStore} from '../../shared/state/run-store';
import {useUiStore} from '../../shared/state/ui-store';
import {GlobalInfoPopupHost} from '../../shared/ui/GlobalInfoPopupHost';

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

const closeIconButtonStyle: CSSProperties = {
    width: 24,
    height: 24,
    border: '1px solid #d5dff0',
    borderRadius: 8,
    background: '#fff',
    color: '#475569',
    cursor: 'pointer',
    padding: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
};

const projectNameBaseStyle: CSSProperties = {
    border: 'none',
    background: 'transparent',
    padding: 0,
    height: 32,
    lineHeight: '32px',
    textAlign: 'left',
    color: '#1e293b',
    fontSize: 14,
    fontWeight: 700,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    position: 'relative',
    top: -1,
    left: 1,
};

const historyTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
});
const INSPECTOR_TRANSITION_MS = 220;
const INSPECTOR_DOCK_WIDTH = 352;
const NON_LINEAR_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const PANEL_EXPANDED_WIDTH = 300;
const PANEL_COLLAPSED_MAX_HEIGHT = 48;
const PANEL_EXPANDED_MAX_HEIGHT = 360;
const PANEL_COLLAPSED_MIN_WIDTH = 176;
const PANEL_COLLAPSED_MAX_WIDTH = 520;
const PANEL_COLLAPSED_HORIZONTAL_PADDING = 16;
const PANEL_COLLAPSED_HEADER_FIXED_WIDTH = 41;
const PANEL_COLLAPSED_EXTRA_WIDTH = 16;
const IGNORED_REVIEW_ISSUE_CODES = new Set(['graph.empty_nodes']);
const INFO_POPUP_TOP = 104;

const estimateProjectNameWidth = (text: string): number => {
    return Array.from(text).reduce((total, char) => {
        if (/\s/.test(char)) {
            return total + 4;
        }
        if (/[\u3400-\u9fff\uf900-\ufaff]/.test(char)) {
            return total + 13.6;
        }
        if (/[A-Z0-9_]/.test(char)) {
            return total + 8.8;
        }
        return total + 8.1;
    }, 0);
};

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
    const setGraphMeta = useGraphStore((state) => state.setGraphMeta);
    const replaceGraph = useGraphStore((state) => state.replaceGraph);
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

    const [savedGraphs, setSavedGraphs] = useState<GraphSummary[]>([]);
    const [panelExpanded, setPanelExpanded] = useState(false);
    const [projectNameDraft, setProjectNameDraft] = useState(graph.graph_id);
    const [projectNameSelected, setProjectNameSelected] = useState(false);
    const [projectNameEditing, setProjectNameEditing] = useState(false);
    const [isPersisting, setIsPersisting] = useState(false);
    const [isReviewing, setIsReviewing] = useState(false);
    const [isInspectorMounted, setIsInspectorMounted] = useState(selectedNodeId !== null);
    const [isInspectorActive, setIsInspectorActive] = useState(selectedNodeId !== null);
    const reviewRequestIdRef = useRef(0);
    const previousSelectedNodeIdRef = useRef<string | null>(selectedNodeId);
    const persistencePanelRef = useRef<HTMLElement | null>(null);
    const historyDrawerAreaRef = useRef<HTMLElement | null>(null);
    const reviewDrawerAreaRef = useRef<HTMLElement | null>(null);
    const hasNodes = graph.nodes.length > 0;

    const reviewIssues = useMemo(
        () => validationIssues.filter((issue) => !IGNORED_REVIEW_ISSUE_CODES.has(issue.code)),
        [validationIssues],
    );
    const displayProjectName = projectNameDraft || graph.graph_id;
    const collapsedPanelWidth = useMemo(() => {
        const nameWidth = estimateProjectNameWidth(displayProjectName);
        const calculatedWidth = PANEL_COLLAPSED_HORIZONTAL_PADDING
            + PANEL_COLLAPSED_HEADER_FIXED_WIDTH
            + PANEL_COLLAPSED_EXTRA_WIDTH
            + nameWidth;
        return Math.min(PANEL_COLLAPSED_MAX_WIDTH, Math.max(PANEL_COLLAPSED_MIN_WIDTH, Math.ceil(calculatedWidth)));
    }, [displayProjectName]);

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

    useEffect(() => {
        if (!projectNameEditing) {
            setProjectNameDraft(graph.graph_id);
        }
    }, [graph.graph_id, projectNameEditing]);

    const toClientErrorMessage = (error: unknown): string =>
        error instanceof ApiClientError ? error.message : String(error);

    const showInfoPopup = (message: string | null): void => {
        if (message === null) {
            clearGlobalInfoMessage();
            return;
        }
        pushGlobalInfoMessage(message);
    };

    const openPanel = (): void => {
        setProjectNameSelected(false);
        setProjectNameEditing(false);
        setPanelExpanded(true);
    };

    const collapsePanel = (): void => {
        setProjectNameSelected(false);
        setProjectNameEditing(false);
        setPanelExpanded(false);
    };

    useEffect(() => {
        if (!panelExpanded && !historyDrawerOpen && !reviewDrawerOpen) {
            return;
        }
        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) {
                return;
            }
            const insidePersistencePanel = persistencePanelRef.current?.contains(target) ?? false;
            const insideHistoryDrawerArea = historyDrawerAreaRef.current?.contains(target) ?? false;
            const insideReviewDrawerArea = reviewDrawerAreaRef.current?.contains(target) ?? false;

            if (panelExpanded && !insidePersistencePanel) {
                setProjectNameSelected(false);
                setProjectNameEditing(false);
                setPanelExpanded(false);
            }
            if (historyDrawerOpen && !insideHistoryDrawerArea) {
                setHistoryDrawerOpen(false);
            }
            if (reviewDrawerOpen && !insideReviewDrawerArea) {
                setReviewDrawerOpen(false);
            }
        };
        window.addEventListener('pointerdown', handlePointerDown);
        return () => {
            window.removeEventListener('pointerdown', handlePointerDown);
        };
    }, [historyDrawerOpen, panelExpanded, reviewDrawerOpen, setHistoryDrawerOpen, setReviewDrawerOpen]);

    const commitProjectNameEdit = (): void => {
        const normalizedProjectName = projectNameDraft.trim();
        if (!normalizedProjectName) {
            setProjectNameDraft(graph.graph_id);
            setProjectNameSelected(false);
            setProjectNameEditing(false);
            showInfoPopup(t('workbench.persistence.errors.emptyGraphId'));
            return;
        }
        if (normalizedProjectName !== graph.graph_id) {
            setGraphMeta(normalizedProjectName, graph.version);
        }
        setProjectNameDraft(normalizedProjectName);
        setProjectNameSelected(false);
        setProjectNameEditing(false);
    };

    const cancelProjectNameEdit = (): void => {
        setProjectNameDraft(graph.graph_id);
        setProjectNameSelected(false);
        setProjectNameEditing(false);
    };

    const handleProjectNameClick = (): void => {
        setProjectNameSelected(true);
    };

    const handleProjectNameDoubleClick = (): void => {
        setProjectNameEditing(true);
    };

    const pullSavedGraphs = async (): Promise<GraphSummary[]> => {
        const payload = await apiClient.listGraphs();
        setSavedGraphs(payload.items);
        return payload.items;
    };

    useEffect(() => {
        const loadSavedGraphs = async (): Promise<void> => {
            try {
                await pullSavedGraphs();
            } catch (error) {
                const message = toClientErrorMessage(error);
                showInfoPopup(t('workbench.persistence.errors.listFailed', {message}));
            }
        };
        void loadSavedGraphs();
        // 初始进入工作台时加载一次已保存图列表。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const refreshSavedGraphs = async (): Promise<void> => {
        setIsPersisting(true);
        showInfoPopup(null);
        try {
            await pullSavedGraphs();
            showInfoPopup(t('workbench.persistence.success.refreshed'));
        } catch (error) {
            const message = toClientErrorMessage(error);
            showInfoPopup(t('workbench.persistence.errors.listFailed', {message}));
        } finally {
            setIsPersisting(false);
        }
    };

    const saveCurrentGraph = async (): Promise<void> => {
        const normalizedGraphId = graph.graph_id.trim();
        if (!normalizedGraphId) {
            showInfoPopup(t('workbench.persistence.errors.emptyGraphId'));
            return;
        }

        setIsPersisting(true);
        showInfoPopup(null);
        try {
            const saved = await apiClient.saveGraph(graph);
            await pullSavedGraphs();
            showInfoPopup(t('workbench.persistence.success.saved', {graphId: saved.graph_id}));
        } catch (error) {
            const message = toClientErrorMessage(error);
            showInfoPopup(t('workbench.persistence.errors.saveFailed', {message}));
        } finally {
            setIsPersisting(false);
        }
    };

    const loadSavedGraph = async (graphId: string): Promise<void> => {
        if (isDirty) {
            const confirmed = window.confirm(t('workbench.persistence.confirm.overwriteDirty'));
            if (!confirmed) {
                return;
            }
        }

        setIsPersisting(true);
        showInfoPopup(null);
        try {
            const loaded = await apiClient.getGraph(graphId);
            replaceGraph(loaded);
            try {
                const report = await apiClient.validateGraph(loaded);
                setValidationResult(report.valid, report.issues);
            } catch (validationError) {
                const validationMessage = toClientErrorMessage(validationError);
                setValidationResult(false, [
                    {
                        level: 'error',
                        code: 'client.validation_request_failed',
                        message: validationMessage,
                    },
                ]);
            }
            showInfoPopup(t('workbench.persistence.success.loaded', {graphId: loaded.graph_id}));
        } catch (error) {
            const message = toClientErrorMessage(error);
            showInfoPopup(t('workbench.persistence.errors.loadFailed', {message}));
        } finally {
            setIsPersisting(false);
        }
    };

    const deleteSavedGraph = async (graphId: string): Promise<void> => {
        const confirmed = window.confirm(
            t('workbench.persistence.confirm.deleteGraph', {graphId}),
        );
        if (!confirmed) {
            return;
        }

        setIsPersisting(true);
        showInfoPopup(null);
        try {
            await apiClient.deleteGraph(graphId);
            await pullSavedGraphs();
            showInfoPopup(t('workbench.persistence.success.deleted', {graphId}));
        } catch (error) {
            const message = toClientErrorMessage(error);
            showInfoPopup(t('workbench.persistence.errors.deleteFailed', {message}));
        } finally {
            setIsPersisting(false);
        }
    };

    const formatGraphUpdatedAt = (updatedAt: number): string => {
        const date = new Date(updatedAt * 1000);
        if (Number.isNaN(date.getTime())) {
            return '-';
        }
        return date.toLocaleString();
    };

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
                ref={persistencePanelRef}
                style={{
                    ...surfaceStyle,
                    position: 'absolute',
                    left: 10,
                    top: 10,
                    zIndex: 10,
                    width: panelExpanded ? PANEL_EXPANDED_WIDTH : collapsedPanelWidth,
                    padding: 8,
                    boxSizing: 'border-box',
                    maxHeight: panelExpanded ? PANEL_EXPANDED_MAX_HEIGHT : PANEL_COLLAPSED_MAX_HEIGHT,
                    overflow: 'hidden',
                    transition: `width 260ms ${NON_LINEAR_EASE}, max-height 260ms ${NON_LINEAR_EASE}, box-shadow 260ms ${NON_LINEAR_EASE}`,
                }}
                data-testid="graph-persistence-panel"
            >
                <div style={{display: 'flex', alignItems: 'center'}}>
                    <div style={{flex: 1, minWidth: 0}}>
                        {panelExpanded ? (
                            <button
                                type="button"
                                className="button-hover-exempt"
                                style={{
                                    ...projectNameBaseStyle,
                                    width: '100%',
                                    cursor: 'default',
                                    pointerEvents: 'none',
                                }}
                                data-testid="project-name-display"
                            >
                                {displayProjectName}
                            </button>
                        ) : projectNameEditing ? (
                            <input
                                value={projectNameDraft}
                                onChange={(event) => setProjectNameDraft(event.target.value)}
                                onBlur={() => commitProjectNameEdit()}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                        commitProjectNameEdit();
                                    }
                                    if (event.key === 'Escape') {
                                        cancelProjectNameEdit();
                                    }
                                }}
                                autoFocus
                                style={{
                                    width: '100%',
                                    height: 32,
                                    border: 'none',
                                    outline: 'none',
                                    background: 'transparent',
                                    padding: 0,
                                    margin: 0,
                                    fontSize: 14,
                                    fontWeight: 700,
                                    color: '#1e293b',
                                    position: 'relative',
                                    top: -1,
                                    left: 2,
                                }}
                                aria-label="project-name-input"
                            />
                        ) : (
                            <button
                                type="button"
                                className="button-hover-exempt"
                                style={{
                                    ...projectNameBaseStyle,
                                    width: '100%',
                                    textDecoration: projectNameSelected ? 'underline' : 'none',
                                    textUnderlineOffset: 4,
                                    cursor: 'text',
                                }}
                                onClick={() => handleProjectNameClick()}
                                onDoubleClick={() => handleProjectNameDoubleClick()}
                                data-testid="project-name-display"
                            >
                                {displayProjectName}
                            </button>
                        )}
                    </div>
                    <div
                        style={{
                            width: 1,
                            height: 24,
                            background: '#e2e8f0',
                            marginLeft: 6,
                            marginRight: 6,
                            flexShrink: 0,
                        }}
                    />
                    <button
                        type="button"
                        className="icon-hover-button"
                        style={{...floatingButtonStyle, width: 28, height: 28, padding: 0, flexShrink: 0}}
                        onClick={() => {
                            if (panelExpanded) {
                                collapsePanel();
                            } else {
                                openPanel();
                            }
                        }}
                        data-testid={panelExpanded ? 'graph-panel-collapse' : 'graph-panel-expand'}
                        aria-label={panelExpanded ? t('workbench.persistence.actions.collapse') : t('workbench.persistence.actions.expand')}
                    >
                        {panelExpanded ? '▴' : '▾'}
                    </button>
                </div>

                <div
                    style={{
                        marginTop: panelExpanded ? 8 : 0,
                        borderTop: panelExpanded ? '1px solid #e2e8f0' : '1px solid transparent',
                        paddingTop: panelExpanded ? 8 : 0,
                        maxHeight: panelExpanded ? 280 : 0,
                        opacity: panelExpanded ? 1 : 0,
                        transform: panelExpanded ? 'translateY(0)' : 'translateY(-6px)',
                        overflow: 'hidden',
                        pointerEvents: panelExpanded ? 'auto' : 'none',
                        transition: `max-height 260ms ${NON_LINEAR_EASE}, opacity 180ms ${NON_LINEAR_EASE}, transform 260ms ${NON_LINEAR_EASE}, margin-top 260ms ${NON_LINEAR_EASE}, padding-top 260ms ${NON_LINEAR_EASE}, border-color 260ms ${NON_LINEAR_EASE}`,
                    }}
                >
                        <div style={{display: 'flex', gap: 6, marginBottom: 8}}>
                            <button
                                type="button"
                                style={floatingButtonStyle}
                                onClick={() => {
                                    void saveCurrentGraph();
                                }}
                                disabled={isPersisting}
                            >
                                {t('workbench.persistence.actions.save')}
                            </button>
                            <button
                                type="button"
                                style={floatingButtonStyle}
                                onClick={() => {
                                    void refreshSavedGraphs();
                                }}
                                disabled={isPersisting}
                            >
                                {t('workbench.persistence.actions.refresh')}
                            </button>
                        </div>

                        <div style={{fontSize: 12, marginBottom: 6}}>
                            {t('workbench.persistence.savedGraphsLabel')}
                        </div>
                        {savedGraphs.length === 0 ? (
                            <div style={{fontSize: 12, color: '#64748b'}}>
                                {t('workbench.persistence.emptySaved')}
                            </div>
                        ) : (
                            <ul
                                style={{
                                    listStyle: 'none',
                                    margin: 0,
                                    padding: 0,
                                    display: 'grid',
                                    gap: 6,
                                    maxHeight: 180,
                                    overflow: 'auto',
                                }}
                                data-testid="saved-graphs-list"
                            >
                                {savedGraphs.map((item) => (
                                    <li
                                        key={item.graph_id}
                                        style={{
                                            border: '1px solid #e2e8f0',
                                            borderRadius: 8,
                                            padding: 6,
                                            background: '#fff',
                                        }}
                                    >
                                        <div style={{fontSize: 12, fontWeight: 600, color: '#334155'}}>
                                            {item.graph_id}
                                        </div>
                                        <div style={{fontSize: 11, color: '#64748b', marginTop: 2}}>
                                            v{item.version} · {formatGraphUpdatedAt(item.updated_at)}
                                        </div>
                                        <div style={{display: 'flex', gap: 6, marginTop: 6}}>
                                            <button
                                                type="button"
                                                style={floatingButtonStyle}
                                                onClick={() => {
                                                    void loadSavedGraph(item.graph_id);
                                                }}
                                                disabled={isPersisting}
                                            >
                                                {t('workbench.persistence.actions.load')}
                                            </button>
                                            <button
                                                type="button"
                                                style={floatingButtonStyle}
                                                onClick={() => {
                                                    void deleteSavedGraph(item.graph_id);
                                                }}
                                                disabled={isPersisting}
                                            >
                                                {t('workbench.persistence.actions.delete')}
                                            </button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
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
                    <span style={{display: 'inline-flex', alignItems: 'center', gap: 6}}>
                        <Play size={15} aria-hidden="true"/>
                        <span>{runButtonText()}</span>
                    </span>
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

            <GlobalInfoPopupHost
                right={10 + inspectorShift}
                top={INFO_POPUP_TOP}
                zIndex={11}
                extraTransition={`right 180ms ${NON_LINEAR_EASE}`}
                testId="workbench-info-popup"
            />

            <section
                    ref={historyDrawerAreaRef}
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
                <button
                    type="button"
                    title={t('workbench.actions.undo')}
                    aria-label={t('workbench.actions.undo')}
                    className="icon-hover-button"
                    style={{
                        ...floatingButtonStyle,
                        width: 32,
                        height: 32,
                        padding: 0,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                    onClick={() => undo()}
                    disabled={!canUndo}
                >
                    <Undo2 size={15} aria-hidden="true"/>
                </button>
                <button
                    type="button"
                    title={t('workbench.actions.redo')}
                    aria-label={t('workbench.actions.redo')}
                    className="icon-hover-button"
                    style={{
                        ...floatingButtonStyle,
                        width: 32,
                        height: 32,
                        padding: 0,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                    onClick={() => redo()}
                    disabled={!canRedo}
                >
                    <Redo2 size={15} aria-hidden="true"/>
                </button>
                <button
                    type="button"
                    title={t('workbench.history.toggle')}
                    aria-label={t('workbench.history.toggle')}
                    className="icon-hover-button"
                    style={{
                        ...floatingButtonStyle,
                        width: 32,
                        height: 32,
                        padding: 0,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                    onClick={() => {
                        setHistoryDrawerOpen(!historyDrawerOpen);
                        setReviewDrawerOpen(false);
                    }}
                >
                    <History size={15} aria-hidden="true"/>
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
                ref={reviewDrawerAreaRef}
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
                        borderRadius: '14px 0 0 14px',
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
                            style={closeIconButtonStyle}
                            aria-label="Close node inspector"
                            onClick={() => {
                                selectNode(null);
                                setNodeLibraryOpen(false);
                            }}
                        >
                            <X size={14} strokeWidth={2.1} aria-hidden="true"/>
                        </button>
                    </div>
                    <NodeConfigPanel/>
                </aside>
            )}
        </main>
    );
}
