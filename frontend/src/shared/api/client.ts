import type {
    CreateSecretRequest,
    CreateRunRequest,
    CreateRunResponse,
    DeleteGraphResponse,
    GetRunEventsParams,
    GraphListResponse,
    GraphSpec,
    GraphValidationReport,
    NodeTypesResponse,
    RotateSecretRequest,
    RunDiagnosticsResponse,
    RunEventsResponse,
    RunMetricsResponse,
    RunStatusResponse,
    SaveGraphResponse,
    SecretCatalogEntry,
    SecretListResponse,
    SecretUsageResponse,
    StopRunResponse,
    UpdateSecretRequest,
} from '../../entities/workbench/types';

export type ApiErrorKind = 'http' | 'network' | 'parse' | 'validation';

export class ApiClientError extends Error {
    readonly kind: ApiErrorKind;
    readonly status: number | null;
    readonly detail: unknown;

    constructor(message: string, kind: ApiErrorKind, status: number | null, detail: unknown) {
        super(message);
        this.name = 'ApiClientError';
        this.kind = kind;
        this.status = status;
        this.detail = detail;
    }
}

export interface ApiClientOptions {
    baseUrl?: string;
    fetchImpl?: typeof fetch;
    requestTimeoutMs?: number;
}

export interface ApiClient {
    getBaseUrl: () => string;
    listNodeTypes: () => Promise<NodeTypesResponse>;
    validateGraph: (graph: GraphSpec) => Promise<GraphValidationReport>;
    listSecrets: () => Promise<SecretListResponse>;
    createSecret: (request: CreateSecretRequest) => Promise<SecretCatalogEntry>;
    updateSecret: (secretId: string, request: UpdateSecretRequest) => Promise<SecretCatalogEntry>;
    rotateSecret: (secretId: string, request: RotateSecretRequest) => Promise<SecretCatalogEntry>;
    deleteSecret: (secretId: string) => Promise<{ secret_id: string; deleted: boolean }>;
    getSecretUsage: (secretId: string) => Promise<SecretUsageResponse>;
    listGraphs: () => Promise<GraphListResponse>;
    getGraph: (graphId: string) => Promise<GraphSpec>;
    saveGraph: (graph: GraphSpec) => Promise<SaveGraphResponse>;
    deleteGraph: (graphId: string) => Promise<DeleteGraphResponse>;
    createRun: (request: CreateRunRequest) => Promise<CreateRunResponse>;
    stopRun: (runId: string) => Promise<StopRunResponse>;
    getRunStatus: (runId: string) => Promise<RunStatusResponse>;
    getRunEvents: (runId: string, params?: GetRunEventsParams) => Promise<RunEventsResponse>;
    getRunMetrics: (runId: string) => Promise<RunMetricsResponse>;
    getRunDiagnostics: (runId: string) => Promise<RunDiagnosticsResponse>;
    buildRunEventsWsUrl: (runId: string, params?: GetRunEventsParams) => string;
}

const DEFAULT_API_BASE_URL = 'http://127.0.0.1:8000';
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

const normalizeRequiredText = (label: string, value: string): string => {
    const normalized = value.trim();
    if (!normalized) {
        throw new ApiClientError(`${label} cannot be empty`, 'validation', null, {value});
    }
    return normalized;
};

const normalizeBaseUrl = (rawValue?: string): string => {
    const fallback = import.meta.env.VITE_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL;
    const base = (rawValue ?? fallback).trim();
    if (!base) {
        return fallback;
    }
    return trimTrailingSlash(base);
};

const normalizeTimeoutMs = (rawValue?: number): number => {
    const envRaw = import.meta.env.VITE_API_TIMEOUT_MS?.trim();
    const envValue = envRaw ? Number(envRaw) : Number.NaN;
    const fallback = Number.isFinite(envValue) ? envValue : DEFAULT_REQUEST_TIMEOUT_MS;
    const candidate = rawValue ?? fallback;
    if (!Number.isFinite(candidate)) {
        return fallback;
    }
    return Math.max(1, Math.floor(candidate));
};

const asRecord = (payload: unknown): Record<string, unknown> | null => {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        return payload as Record<string, unknown>;
    }
    return null;
};

const extractErrorMessage = (payload: unknown, fallback: string): string => {
    const record = asRecord(payload);
    if (!record) {
        return fallback;
    }

    const message = record.message;
    if (typeof message === 'string' && message.trim()) {
        return message;
    }

    const detail = record.detail;
    if (typeof detail === 'string' && detail.trim()) {
        return detail;
    }
    const detailRecord = asRecord(detail);
    if (detailRecord) {
        const detailMessage = detailRecord.message;
        if (typeof detailMessage === 'string' && detailMessage.trim()) {
            return detailMessage;
        }
    }

    return fallback;
};

const parseJsonText = (text: string, status: number): unknown => {
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new ApiClientError('Response JSON parse failed', 'parse', status, {
            raw: text,
            cause: String(error),
        });
    }
};

const applyRunEventParams = (url: URL, params?: GetRunEventsParams): void => {
    if (!params) {
        return;
    }

    if (typeof params.since === 'number') {
        url.searchParams.set('since', String(Math.max(0, params.since)));
    }
    if (typeof params.limit === 'number') {
        url.searchParams.set('limit', String(params.limit));
    }
    if (params.event_type) {
        url.searchParams.set('event_type', params.event_type);
    }
    if (params.node_id) {
        url.searchParams.set('node_id', params.node_id);
    }
    if (params.severity) {
        url.searchParams.set('severity', params.severity);
    }
    if (params.error_code) {
        url.searchParams.set('error_code', params.error_code);
    }
};

export const createApiClient = (options: ApiClientOptions = {}): ApiClient => {
    const baseUrl = normalizeBaseUrl(options.baseUrl);
    const requestTimeoutMs = normalizeTimeoutMs(options.requestTimeoutMs);

    const buildUrl = (path: string): URL => new URL(path, `${baseUrl}/`);

    const requestJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
        const headers = new Headers(init?.headers);
        if (!headers.has('Accept')) {
            headers.set('Accept', 'application/json');
        }

        const method = init?.method?.toUpperCase() ?? 'GET';
        if (method !== 'GET' && method !== 'HEAD' && !headers.has('Content-Type')) {
            headers.set('Content-Type', 'application/json');
        }

        let response: Response;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        let timeoutTriggered = false;
        const timeoutController = new AbortController();
        const requestSignal = init?.signal ?? timeoutController.signal;
        if (!init?.signal) {
            timeoutId = setTimeout(() => {
                timeoutTriggered = true;
                timeoutController.abort();
            }, requestTimeoutMs);
        }
        try {
            const fetchImpl = options.fetchImpl ?? fetch;
            response = await fetchImpl(buildUrl(path), {
                ...init,
                headers,
                signal: requestSignal,
            });
        } catch (error) {
            if (timeoutTriggered) {
                throw new ApiClientError(
                    `Request timed out after ${requestTimeoutMs}ms`,
                    'network',
                    null,
                    String(error),
                );
            }
            throw new ApiClientError('Network request failed', 'network', null, String(error));
        } finally {
            if (timeoutId !== null) {
                clearTimeout(timeoutId);
            }
        }

        const rawText = await response.text();
        const payload = rawText.trim() ? parseJsonText(rawText, response.status) : {};

        if (!response.ok) {
            throw new ApiClientError(
                extractErrorMessage(payload, `HTTP ${response.status}`),
                'http',
                response.status,
                payload,
            );
        }

        return payload as T;
    };

    const buildRunPath = (runId: string, suffix = ''): string => {
        const normalizedRunId = normalizeRequiredText('runId', runId);
        return `/api/v1/runs/${encodeURIComponent(normalizedRunId)}${suffix}`;
    };

    const buildGraphPath = (graphId: string, suffix = ''): string => {
        const normalizedGraphId = normalizeRequiredText('graphId', graphId);
        return `/api/v1/graphs/${encodeURIComponent(normalizedGraphId)}${suffix}`;
    };

    const buildSecretPath = (secretId = '', suffix = ''): string => {
        const normalizedSecretId = secretId ? normalizeRequiredText('secretId', secretId) : '';
        const encoded = normalizedSecretId ? `/${encodeURIComponent(normalizedSecretId)}` : '';
        return `/api/v1/secrets${encoded}${suffix}`;
    };

    const buildRunEventsWsUrl = (runId: string, params?: GetRunEventsParams): string => {
        const base = buildUrl(buildRunPath(runId, '/events'));
        base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
        applyRunEventParams(base, params);
        return base.toString();
    };

    return {
        getBaseUrl: () => baseUrl,
        listNodeTypes: () => requestJson<NodeTypesResponse>('/api/v1/node-types'),
        validateGraph: (graph: GraphSpec) =>
            requestJson<GraphValidationReport>('/api/v1/graphs/validate', {
                method: 'POST',
                body: JSON.stringify(graph),
            }),
        listSecrets: () => requestJson<SecretListResponse>(buildSecretPath()),
        createSecret: (request: CreateSecretRequest) =>
            requestJson<SecretCatalogEntry>(buildSecretPath(), {
                method: 'POST',
                body: JSON.stringify(request),
            }),
        updateSecret: (secretId: string, request: UpdateSecretRequest) =>
            requestJson<SecretCatalogEntry>(buildSecretPath(secretId), {
                method: 'PATCH',
                body: JSON.stringify(request),
            }),
        rotateSecret: (secretId: string, request: RotateSecretRequest) =>
            requestJson<SecretCatalogEntry>(buildSecretPath(secretId, '/rotate'), {
                method: 'POST',
                body: JSON.stringify(request),
            }),
        deleteSecret: (secretId: string) =>
            requestJson<{ secret_id: string; deleted: boolean }>(buildSecretPath(secretId), {
                method: 'DELETE',
            }),
        getSecretUsage: (secretId: string) =>
            requestJson<SecretUsageResponse>(buildSecretPath(secretId, '/usage')),
        listGraphs: () => requestJson<GraphListResponse>('/api/v1/graphs'),
        getGraph: (graphId: string) => requestJson<GraphSpec>(buildGraphPath(graphId)),
        saveGraph: (graph: GraphSpec) =>
            requestJson<SaveGraphResponse>(buildGraphPath(graph.graph_id), {
                method: 'PUT',
                body: JSON.stringify(graph),
            }),
        deleteGraph: (graphId: string) =>
            requestJson<DeleteGraphResponse>(buildGraphPath(graphId), {
                method: 'DELETE',
            }),
        createRun: (request: CreateRunRequest) => {
            const normalizedStreamId = normalizeRequiredText('stream_id', request.stream_id);
            return requestJson<CreateRunResponse>('/api/v1/runs', {
                method: 'POST',
                body: JSON.stringify({
                    ...request,
                    stream_id: normalizedStreamId,
                }),
            });
        },
        stopRun: (runId: string) =>
            requestJson<StopRunResponse>(buildRunPath(runId, '/stop'), {
                method: 'POST',
            }),
        getRunStatus: (runId: string) => requestJson<RunStatusResponse>(buildRunPath(runId)),
        getRunEvents: (runId: string, params?: GetRunEventsParams) => {
            const url = buildUrl(buildRunPath(runId, '/events'));
            applyRunEventParams(url, params);
            return requestJson<RunEventsResponse>(`${url.pathname}${url.search}`);
        },
        getRunMetrics: (runId: string) =>
            requestJson<RunMetricsResponse>(buildRunPath(runId, '/metrics')),
        getRunDiagnostics: (runId: string) =>
            requestJson<RunDiagnosticsResponse>(buildRunPath(runId, '/diagnostics')),
        buildRunEventsWsUrl,
    };
};

export const apiClient = createApiClient();
