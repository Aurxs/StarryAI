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
    height: '100dvh',
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
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid rgba(148, 163, 184, 0.5)',
    borderRadius: 8,
    padding: '4px 8px',
    fontSize: 12,
    cursor: 'pointer',
    background: 'rgba(15, 23, 42, 0.85)',
    color: '#e2e8f0',
    lineHeight: 1,
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

const topBannerStyle: CSSProperties = {
    position: 'absolute',
    top: 10,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 7,
    pointerEvents: 'none',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
};

const topTitleStyle: CSSProperties = {
    margin: 0,
    padding: '8px 14px',
    borderRadius: 10,
    border: '1px solid rgba(148, 163, 184, 0.35)',
    background: 'rgba(15, 23, 42, 0.72)',
    fontSize: 18,
    color: '#f8fafc',
};

const topSubtitleStyle: CSSProperties = {
    margin: 0,
    fontSize: 12,
    color: 'rgba(226, 232, 240, 0.92)',
};

const toLeftPanelLabel = (value: string): string => {
    switch (value) {
        case 'node-library':
            return '节点库';
        case 'graph-outline':
            return '图结构';
        default:
            return value;
    }
};

const toRightPanelLabel = (value: string): string => {
    switch (value) {
        case 'node-config':
            return '节点配置';
        case 'run-inspector':
            return '运行洞察';
        default:
            return value;
    }
};

const toRunStatusLabel = (value: string): string => {
    switch (value) {
        case 'idle':
            return '空闲';
        case 'validating':
            return '校验中';
        case 'running':
            return '运行中';
        case 'stopped':
            return '已停止';
        case 'completed':
            return '已完成';
        case 'failed':
            return '失败';
        default:
            return value;
    }
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
            <header style={topBannerStyle}>
                <h1 style={topTitleStyle}>StarryAI 工作台</h1>
                <p style={topSubtitleStyle}>Phase E / T2 基线框架</p>
            </header>

            {leftCollapsed ? (
                <button
                    type="button"
                    style={{...collapseButtonStyle, position: 'absolute', left: 12, top: 12, zIndex: 9}}
                    onClick={() => setLeftCollapsed(false)}
                >
                    显示左侧
                </button>
            ) : (
                <aside
                    style={{
                        ...floatingCardStyle,
                        position: 'absolute',
                        left: 12,
                        top: 12,
                        width: 340,
                        maxHeight: 'calc(100dvh - 24px)',
                        overflow: 'auto',
                    }}
                    aria-label="left-panel"
                >
                    <div style={panelHeaderStyle}>
                        <h2 style={panelTitleStyle}>工作台</h2>
                        <button type="button" style={collapseButtonStyle} onClick={() => setLeftCollapsed(true)}>
                            收起
                        </button>
                    </div>
                    <div>
                        <button
                            type="button"
                            style={chipStyle(leftPanel === 'node-library')}
                            onClick={() => setLeftPanel('node-library')}
                        >
                            节点库
                        </button>
                        <button
                            type="button"
                            style={chipStyle(leftPanel === 'graph-outline')}
                            onClick={() => setLeftPanel('graph-outline')}
                        >
                            图结构
                        </button>
                    </div>
                    <p style={{fontSize: 13, opacity: 0.9}} data-testid="left-panel-value">
                        当前: {toLeftPanelLabel(leftPanel)}
                    </p>

                    <div style={{display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8}}>
                        <article
                            style={{...floatingCardStyle, padding: 8, background: 'rgba(30, 41, 59, 0.72)'}}
                            data-testid="summary-graph-id"
                        >
                            <strong style={{fontSize: 12}}>图 ID</strong>
                            <div style={valueStyle}>{summary.graphId}</div>
                        </article>
                        <article
                            style={{...floatingCardStyle, padding: 8, background: 'rgba(30, 41, 59, 0.72)'}}
                            data-testid="summary-node-count"
                        >
                            <strong style={{fontSize: 12}}>节点数</strong>
                            <div style={valueStyle}>{summary.nodeCount}</div>
                        </article>
                        <article
                            style={{...floatingCardStyle, padding: 8, background: 'rgba(30, 41, 59, 0.72)'}}
                            data-testid="summary-edge-count"
                        >
                            <strong style={{fontSize: 12}}>边数</strong>
                            <div style={valueStyle}>{summary.edgeCount}</div>
                        </article>
                    </div>

                    <div style={{marginTop: 10, fontSize: 13, lineHeight: 1.45}}>
                        <div data-testid="selected-node">已选节点: {selectedNodeId ?? '无'}</div>
                        <div data-testid="run-status">
                            运行状态: {toRunStatusLabel(runStatus)}
                            {isBusy ? '（处理中）' : ''}
                        </div>
                        <div data-testid="run-id">运行 ID: {runId ?? '无'}</div>
                    </div>
                </aside>
            )}

            {rightCollapsed ? (
                <button
                    type="button"
                    style={{...collapseButtonStyle, position: 'absolute', right: 12, top: 12, zIndex: 9}}
                    onClick={() => setRightCollapsed(false)}
                >
                    显示右侧
                </button>
            ) : (
                <aside
                    style={{
                        ...floatingCardStyle,
                        position: 'absolute',
                        right: 12,
                        top: 12,
                        width: 360,
                        maxHeight: 'calc(100dvh - 24px)',
                        overflow: 'auto',
                    }}
                    aria-label="right-panel"
                >
                    <div style={panelHeaderStyle}>
                        <h2 style={panelTitleStyle}>检查器</h2>
                        <button type="button" style={collapseButtonStyle} onClick={() => setRightCollapsed(true)}>
                            收起
                        </button>
                    </div>
                    <div>
                        <button
                            type="button"
                            style={chipStyle(rightPanel === 'node-config')}
                            onClick={() => setRightPanel('node-config')}
                        >
                            节点配置
                        </button>
                        <button
                            type="button"
                            style={chipStyle(rightPanel === 'run-inspector')}
                            onClick={() => setRightPanel('run-inspector')}
                        >
                            运行洞察
                        </button>
                    </div>
                    <p style={{fontSize: 13, opacity: 0.9}} data-testid="right-panel-value">
                        当前: {toRightPanelLabel(rightPanel)}
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
                    显示控制台
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
                        <h2 style={panelTitleStyle}>运行控制台</h2>
                        <button type="button" style={collapseButtonStyle} onClick={() => setBottomCollapsed(true)}>
                            收起
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
