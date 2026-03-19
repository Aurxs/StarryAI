export type NodeMode = 'async' | 'sync' | 'passive';

export type InputBehavior = 'payload' | 'reference' | 'trigger';

export type SyncStrategy = 'barrier' | 'window_join' | 'clock_lock';

export type LatePolicy = 'drop' | 'emit_partial' | 'reclock';

export type SyncRole = 'initiator' | 'executor';

export interface PortSpec {
    name: string;
    frame_schema: string;
    is_stream: boolean;
    required: boolean;
    description: string;
    input_behavior?: InputBehavior;
    derived_from_input?: string | null;
}

export interface SyncConfig {
    required_ports: string[];
    strategy: SyncStrategy;
    window_ms: number;
    late_policy: LatePolicy;
    role?: SyncRole;
    sync_group?: string | null;
    commit_lead_ms?: number;
    ready_timeout_ms?: number;
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
    tags?: string[];
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

export type GraphVariableValueKind =
    | 'scalar.int'
    | 'scalar.float'
    | 'scalar.string'
    | 'json.list'
    | 'json.dict'
    | 'json.any';

export interface GraphVariableSpec {
    name: string;
    value_kind: GraphVariableValueKind;
    initial_value: unknown;
}

export type GraphVariableReferenceField =
    | 'variable_name'
    | 'target_variable_name'
    | 'operand_variable_name';

export interface GraphVariableUsage {
    node_id: string;
    node_title: string;
    node_type: string;
    field_name: GraphVariableReferenceField;
}

export interface GraphDataRegistry {
    variables: GraphVariableSpec[];
}

export interface GraphMetadata {
    data_registry?: GraphDataRegistry;
    [key: string]: unknown;
}

export interface GraphSpec {
    graph_id: string;
    version: string;
    nodes: NodeInstanceSpec[];
    edges: EdgeSpec[];
    metadata: GraphMetadata;
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

export interface GraphIncompatibility {
    code: string;
    message: string;
}

export interface GraphSummary {
    graph_id: string;
    version: string;
    updated_at: number;
    incompatibility?: GraphIncompatibility | null;
}

export interface GraphListResponse {
    count: number;
    items: GraphSummary[];
}

export interface SaveGraphResponse {
    graph_id: string;
    version: string;
    updated_at: number;
}

export interface DeleteGraphResponse {
    graph_id: string;
    deleted: boolean;
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

export interface SecretRef {
    $kind: 'secret_ref';
    secret_id: string;
}

export interface SecretCatalogEntry {
    secret_id: string;
    label: string;
    kind: string;
    description: string;
    provider: string;
    created_at: number;
    updated_at: number;
    usage_count: number;
    in_use: boolean;
}

export interface SecretListResponse {
    count: number;
    items: SecretCatalogEntry[];
}

export interface CreateSecretRequest {
    label: string;
    value: string;
    kind?: string;
    description?: string;
    secret_id?: string | null;
}

export interface UpdateSecretRequest {
    label?: string | null;
    kind?: string | null;
    description?: string | null;
}

export interface RotateSecretRequest {
    value: string;
}

export interface SecretUsageEntry {
    graph_id: string;
    node_id: string;
    field_path: string;
}

export interface SecretUsageResponse {
    secret_id: string;
    usage_count: number;
    in_use: boolean;
    items: SecretUsageEntry[];
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
