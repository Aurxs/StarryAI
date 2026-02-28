import {useMemo, type CSSProperties} from 'react';

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
    minHeight: '100vh',
    display: 'grid',
    gridTemplateColumns: '280px 1fr 320px',
    gridTemplateRows: '1fr 240px',
    gridTemplateAreas: '"left canvas right" "footer footer footer"',
    gap: 12,
    padding: 12,
    boxSizing: 'border-box',
    background:
        'linear-gradient(135deg, rgba(252,243,211,0.95), rgba(214,234,248,0.95) 50%, rgba(215,245,228,0.95))',
    color: '#1f2933',
    fontFamily: '"Avenir Next", "Segoe UI", sans-serif',
};

const cardStyle: CSSProperties = {
    border: '1px solid rgba(31, 41, 51, 0.16)',
    borderRadius: 10,
    background: 'rgba(255, 255, 255, 0.88)',
    padding: 12,
    backdropFilter: 'blur(1px)',
};

const valueStyle: CSSProperties = {
    fontSize: 24,
    fontWeight: 700,
    margin: '8px 0',
};

const chipStyle = (active: boolean): CSSProperties => ({
    border: '1px solid rgba(31, 41, 51, 0.22)',
    borderRadius: 999,
    padding: '4px 10px',
    marginRight: 8,
    marginBottom: 8,
    background: active ? '#1f2933' : 'transparent',
    color: active ? '#ffffff' : '#1f2933',
    cursor: 'pointer',
    fontSize: 12,
});

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
            <aside style={{...cardStyle, gridArea: 'left'}} aria-label="left-panel">
                <h2 style={{marginTop: 0}}>Node Library</h2>
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
                <p style={{fontSize: 13, opacity: 0.84}} data-testid="left-panel-value">
                    Active: {leftPanel}
                </p>
            </aside>

            <section style={{...cardStyle, gridArea: 'canvas'}} aria-label="canvas-panel">
                <h1 style={{marginTop: 0, marginBottom: 8}}>StarryAI Workbench</h1>
                <p style={{marginTop: 0, fontSize: 14, opacity: 0.86}}>
                    Phase E / T2 baseline shell
                </p>

                <div style={{display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8}}>
                    <article style={cardStyle} data-testid="summary-graph-id">
                        <strong>Graph ID</strong>
                        <div style={valueStyle}>{summary.graphId}</div>
                    </article>
                    <article style={cardStyle} data-testid="summary-node-count">
                        <strong>Nodes</strong>
                        <div style={valueStyle}>{summary.nodeCount}</div>
                    </article>
                    <article style={cardStyle} data-testid="summary-edge-count">
                        <strong>Edges</strong>
                        <div style={valueStyle}>{summary.edgeCount}</div>
                    </article>
                </div>

                <div style={{marginTop: 12, fontSize: 14}}>
                    <div data-testid="selected-node">
                        Selected Node: {selectedNodeId ?? 'none'}
                    </div>
                    <div data-testid="run-status">
                        Run Status: {runStatus}
                        {isBusy ? ' (busy)' : ''}
                    </div>
                    <div data-testid="run-id">Run ID: {runId ?? 'none'}</div>
                </div>

                <GraphEditor/>
            </section>

            <aside style={{...cardStyle, gridArea: 'right'}} aria-label="right-panel">
                <h2 style={{marginTop: 0}}>Inspector</h2>
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
                <p style={{fontSize: 13, opacity: 0.84}} data-testid="right-panel-value">
                    Active: {rightPanel}
                </p>

                {rightPanel === 'node-config' ? (
                    <NodeConfigPanel/>
                ) : (
                    <RunInsightsPanel/>
                )}
            </aside>

            <footer style={{...cardStyle, gridArea: 'footer'}} aria-label="runtime-console">
                <h2 style={{marginTop: 0, marginBottom: 8}}>Runtime Console</h2>
                <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10}}>
                    <GraphValidationPanel/>
                    <RunControlPanel/>
                    <RuntimeConsolePanel/>
                </div>
            </footer>
        </main>
    );
}
