export type NodeMode = 'async' | 'sync';

export type SyncStrategy = 'barrier' | 'window_join' | 'clock_lock';

export type LatePolicy = 'drop' | 'emit_partial' | 'reclock';

export interface PortSpec {
    name: string;
    frame_schema: string;
    is_stream: boolean;
    required: boolean;
    description: string;
}

export interface SyncConfig {
    required_ports: string[];
    strategy: SyncStrategy;
    window_ms: number;
    late_policy: LatePolicy;
}

export interface NodeSpec {
    type_name: string;
    version: string;
    mode: NodeMode;
    inputs: PortSpec[];
    outputs: PortSpec[];
    sync_config: SyncConfig | null;
    config_schema: Record<string, unknown>;
    description: string;
}

export interface NodeInstanceSpec {
    node_id: string;
    type_name: string;
    title: string;
    config: Record<string, unknown>;
}

export interface EdgeSpec {
    source_node: string;
    source_port: string;
    target_node: string;
    target_port: string;
    queue_maxsize: number;
}

export interface GraphSpec {
    graph_id: string;
    version: string;
    nodes: NodeInstanceSpec[];
    edges: EdgeSpec[];
    metadata: Record<string, unknown>;
}

export interface ValidationIssue {
    level: 'error' | 'warning';
    code: string;
    message: string;
}

export interface GraphValidationReport {
    graph_id: string;
    valid: boolean;
    issues: ValidationIssue[];
}

export type RuntimeEventType =
    | 'run_started'
    | 'run_stopped'
    | 'node_started'
    | 'node_finished'
    | 'node_retry'
    | 'node_timeout'
    | 'node_failed'
    | 'frame_emitted'
    | 'sync_frame_emitted';

export type RuntimeEventSeverity = 'debug' | 'info' | 'warning' | 'error' | 'critical';

export type RuntimeEventComponent = 'scheduler' | 'node' | 'edge' | 'service' | 'sync' | 'api';

export interface RuntimeEvent {
    run_id: string;
    event_id: string;
    event_seq: number;
    event_type: RuntimeEventType;
    severity: RuntimeEventSeverity;
    component: RuntimeEventComponent;
    ts: number;
    node_id: string | null;
    edge_key: string | null;
    error_code: string | null;
    attempt: number | null;
    message: string | null;
    details: Record<string, unknown>;
}

export interface NodeTypesResponse {
    items: NodeSpec[];
    count: number;
}

export interface CreateRunRequest {
    graph: GraphSpec;
    stream_id: string;
}

export interface CreateRunResponse {
    run_id: string;
    graph_id: string;
    status: string;
}

export interface StopRunResponse {
    run_id: string;
    status: string;
}

export interface RunStatusResponse {
    run_id: string;
    graph_id: string;
    status: string;
    created_at: number;
    started_at: number | null;
    ended_at: number | null;
    stream_id: string;
    last_error: string | null;
    task_done: boolean;
    metrics: Record<string, unknown>;
    node_states: Record<string, Record<string, unknown>>;
    edge_states: Array<Record<string, unknown>>;
}

export interface RunEventsResponse {
    run_id: string;
    next_cursor: number;
    count: number;
    items: RuntimeEvent[];
}

export interface RunMetricsResponse {
    run_id: string;
    graph_id: string;
    status: string;
    created_at: number;
    started_at: number | null;
    ended_at: number | null;
    task_done: boolean;
    graph_metrics: Record<string, unknown>;
    node_metrics: Record<string, Record<string, unknown>>;
    edge_metrics: Array<Record<string, unknown>>;
}

export interface RunDiagnosticsResponse {
    run_id: string;
    graph_id: string;
    status: string;
    task_done: boolean;
    last_error: string | null;
    failed_nodes: Array<Record<string, unknown>>;
    slow_nodes_top: Array<Record<string, unknown>>;
    edge_hotspots_top: Array<Record<string, unknown>>;
}

export interface GetRunEventsParams {
    since?: number;
    limit?: number;
    event_type?: RuntimeEventType;
    node_id?: string;
    severity?: RuntimeEventSeverity;
    error_code?: string;
}
