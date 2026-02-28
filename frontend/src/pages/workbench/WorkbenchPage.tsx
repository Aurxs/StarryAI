import {useMemo, useState, type CSSProperties} from 'react';

import {GraphEditor} from '../../features/graph-editor/GraphEditor';
import {NodeConfigPanel} from '../../features/node-config/NodeConfigPanel';
import {GraphValidationPanel} from '../../features/run-control/GraphValidationPanel';
import {RunControlPanel} from '../../features/run-control/RunControlPanel';
import {RuntimeConsolePanel} from '../../features/runtime-console/RuntimeConsolePanel';
import {RunInsightsPanel} from '../../features/runtime-console/RunInsightsPanel';
import {useGraphStore} from '../../shared/state/graph-store';
import {useRunStore} from '../../shared/state/run-store';
import {useUiStore} from '../../shared/state/ui-store';

const shellStyle: CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '100vh',
    overflow: 'hidden',
    color: '#e5e7eb',
    fontFamily: '"Avenir Next", "Segoe UI", sans-serif',
    background: '#0f172a',
};

const canvasLayerStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    zIndex: 0,
};

const floatingCardStyle: CSSProperties = {
    border: '1px solid rgba(148, 163, 184, 0.35)',
    borderRadius: 10,
    background: 'rgba(15, 23, 42, 0.78)',
    padding: 12,
    backdropFilter: 'blur(6px)',
    boxSizing: 'border-box',
    boxShadow: '0 8px 24px rgba(2, 6, 23, 0.28)',
    zIndex: 8,
};

const valueStyle: CSSProperties = {
    fontSize: 18,
    fontWeight: 700,
    margin: '6px 0',
    color: '#f8fafc',
};

const chipStyle = (active: boolean): CSSProperties => ({
    border: '1px solid rgba(148, 163, 184, 0.5)',
    borderRadius: 999,
    padding: '4px 10px',
    marginRight: 8,
    marginBottom: 8,
    background: active ? '#e2e8f0' : 'transparent',
    color: active ? '#0f172a' : '#e2e8f0',
    cursor: 'pointer',
    fontSize: 12,
});

const collapseButtonStyle: CSSProperties = {
    border: '1px solid rgba(148, 163, 184, 0.5)',
    borderRadius: 8,
    padding: '4px 8px',
    fontSize: 12,
    cursor: 'pointer',
    background: 'rgba(15, 23, 42, 0.85)',
    color: '#e2e8f0',
};

const panelHeaderStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
};

const panelTitleStyle: CSSProperties = {
    margin: 0,
    fontSize: 18,
};

const topTitleStyle: CSSProperties = {
    position: 'absolute',
    top: 12,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 9,
    margin: 0,
    padding: '8px 14px',
    borderRadius: 10,
    border: '1px solid rgba(148, 163, 184, 0.35)',
    background: 'rgba(15, 23, 42, 0.72)',
    fontSize: 18,
    color: '#f8fafc',
    pointerEvents: 'none',
};

const topSubtitleStyle: CSSProperties = {
    position: 'absolute',
    top: 48,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 9,
    margin: 0,
    fontSize: 12,
    color: 'rgba(226, 232, 240, 0.92)',
    pointerEvents: 'none',
};

export function WorkbenchPage() {
    const graph = useGraphStore((state) => state.graph);
    const selectedNodeId = useGraphStore((state) => state.selectedNodeId);
    const runId = useRunStore((state) => state.runId);
    const runStatus = useRunStore((state) => state.status);
    const isBusy = useRunStore((state) => state.isBusy);
    const leftPanel = useUiStore((state) => state.leftPanel);
    const rightPanel = useUiStore((state) => state.rightPanel);
    const setLeftPanel = useUiStore((state) => state.setLeftPanel);
    const setRightPanel = useUiStore((state) => state.setRightPanel);
    const [leftCollapsed, setLeftCollapsed] = useState(false);
    const [rightCollapsed, setRightCollapsed] = useState(false);
    const [bottomCollapsed, setBottomCollapsed] = useState(false);

    const summary = useMemo(
        () => ({
            nodeCount: graph.nodes.length,
            edgeCount: graph.edges.length,
            graphId: graph.graph_id,
        }),
        [graph.edges.length, graph.graph_id, graph.nodes.length],
    );

    return (
        <main style={shellStyle}>
            <section style={canvasLayerStyle} aria-label="canvas-panel">
                <GraphEditor/>
            </section>
            <h1 style={topTitleStyle}>StarryAI Workbench</h1>
            <p style={topSubtitleStyle}>Phase E / T2 baseline shell</p>

            {leftCollapsed ? (
                <button
                    type="button"
                    style={{...collapseButtonStyle, position: 'absolute', left: 12, top: 12, zIndex: 9}}
                    onClick={() => setLeftCollapsed(false)}
                >
                    Show Left
                </button>
            ) : (
                <aside
                    style={{
                        ...floatingCardStyle,
                        position: 'absolute',
                        left: 12,
                        top: 12,
                        width: 340,
                        maxHeight: 'calc(100vh - 24px)',
                        overflow: 'auto',
                    }}
                    aria-label="left-panel"
                >
                    <div style={panelHeaderStyle}>
                        <h2 style={panelTitleStyle}>Workbench</h2>
                        <button type="button" style={collapseButtonStyle} onClick={() => setLeftCollapsed(true)}>
                            Collapse
                        </button>
                    </div>
                    <div>
                        <button
                            type="button"
                            style={chipStyle(leftPanel === 'node-library')}
                            onClick={() => setLeftPanel('node-library')}
                        >
                            Node Library
                        </button>
                        <button
                            type="button"
                            style={chipStyle(leftPanel === 'graph-outline')}
                            onClick={() => setLeftPanel('graph-outline')}
                        >
                            Graph Outline
                        </button>
                    </div>
                    <p style={{fontSize: 13, opacity: 0.9}} data-testid="left-panel-value">
                        Active: {leftPanel}
                    </p>

                    <div style={{display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8}}>
                        <article
                            style={{...floatingCardStyle, padding: 8, background: 'rgba(30, 41, 59, 0.72)'}}
                            data-testid="summary-graph-id"
                        >
                            <strong style={{fontSize: 12}}>Graph ID</strong>
                            <div style={valueStyle}>{summary.graphId}</div>
                        </article>
                        <article
                            style={{...floatingCardStyle, padding: 8, background: 'rgba(30, 41, 59, 0.72)'}}
                            data-testid="summary-node-count"
                        >
                            <strong style={{fontSize: 12}}>Nodes</strong>
                            <div style={valueStyle}>{summary.nodeCount}</div>
                        </article>
                        <article
                            style={{...floatingCardStyle, padding: 8, background: 'rgba(30, 41, 59, 0.72)'}}
                            data-testid="summary-edge-count"
                        >
                            <strong style={{fontSize: 12}}>Edges</strong>
                            <div style={valueStyle}>{summary.edgeCount}</div>
                        </article>
                    </div>

                    <div style={{marginTop: 10, fontSize: 13, lineHeight: 1.45}}>
                        <div data-testid="selected-node">Selected Node: {selectedNodeId ?? 'none'}</div>
                        <div data-testid="run-status">
                            Run Status: {runStatus}
                            {isBusy ? ' (busy)' : ''}
                        </div>
                        <div data-testid="run-id">Run ID: {runId ?? 'none'}</div>
                    </div>
                </aside>
            )}

            {rightCollapsed ? (
                <button
                    type="button"
                    style={{...collapseButtonStyle, position: 'absolute', right: 12, top: 12, zIndex: 9}}
                    onClick={() => setRightCollapsed(false)}
                >
                    Show Right
                </button>
            ) : (
                <aside
                    style={{
                        ...floatingCardStyle,
                        position: 'absolute',
                        right: 12,
                        top: 12,
                        width: 360,
                        maxHeight: 'calc(100vh - 24px)',
                        overflow: 'auto',
                    }}
                    aria-label="right-panel"
                >
                    <div style={panelHeaderStyle}>
                        <h2 style={panelTitleStyle}>Inspector</h2>
                        <button type="button" style={collapseButtonStyle} onClick={() => setRightCollapsed(true)}>
                            Collapse
                        </button>
                    </div>
                    <div>
                        <button
                            type="button"
                            style={chipStyle(rightPanel === 'node-config')}
                            onClick={() => setRightPanel('node-config')}
                        >
                            Node Config
                        </button>
                        <button
                            type="button"
                            style={chipStyle(rightPanel === 'run-inspector')}
                            onClick={() => setRightPanel('run-inspector')}
                        >
                            Run Inspector
                        </button>
                    </div>
                    <p style={{fontSize: 13, opacity: 0.9}} data-testid="right-panel-value">
                        Active: {rightPanel}
                    </p>

                    {rightPanel === 'node-config' ? (
                        <NodeConfigPanel/>
                    ) : (
                        <RunInsightsPanel/>
                    )}
                </aside>
            )}

            {bottomCollapsed ? (
                <button
                    type="button"
                    style={{...collapseButtonStyle, position: 'absolute', left: 12, bottom: 12, zIndex: 9}}
                    onClick={() => setBottomCollapsed(false)}
                >
                    Show Runtime
                </button>
            ) : (
                <footer
                    style={{
                        ...floatingCardStyle,
                        position: 'absolute',
                        left: 12,
                        right: 12,
                        bottom: 12,
                        maxHeight: 280,
                        overflow: 'auto',
                    }}
                    aria-label="runtime-console"
                >
                    <div style={panelHeaderStyle}>
                        <h2 style={panelTitleStyle}>Runtime Console</h2>
                        <button type="button" style={collapseButtonStyle} onClick={() => setBottomCollapsed(true)}>
                            Collapse
                        </button>
                    </div>
                    <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10}}>
                        <GraphValidationPanel/>
                        <RunControlPanel/>
                        <RuntimeConsolePanel/>
                    </div>
                </footer>
            )}
        </main>
    );
}
