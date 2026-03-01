import {http, HttpResponse} from 'msw';
import {afterEach, describe, expect, it, vi} from 'vitest';

import type {GraphSpec} from '../../src/entities/workbench/types';
import {ApiClientError, createApiClient} from '../../src/shared/api/client';
import {server} from '../mocks/server';

const graphFixture: GraphSpec = {
    graph_id: 'graph_t1',
    version: '0.1.0',
    nodes: [],
    edges: [],
    metadata: {},
};

describe('API client', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('uses VITE_API_BASE_URL as default base URL when baseUrl is omitted', () => {
        vi.stubEnv('VITE_API_BASE_URL', 'http://127.0.0.1:18080/');
        const client = createApiClient();
        expect(client.getBaseUrl()).toBe('http://127.0.0.1:18080');
    });

    it('fails fast when request times out', async () => {
        const hangingFetch: typeof fetch = ((_input: URL | RequestInfo, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
                const signal = init?.signal;
                signal?.addEventListener(
                    'abort',
                    () => reject(new DOMException('Aborted', 'AbortError')),
                    {once: true},
                );
            })) as typeof fetch;

        const client = createApiClient({
            baseUrl: 'http://127.0.0.1:8000',
            fetchImpl: hangingFetch,
            requestTimeoutMs: 20,
        });

        await expect(client.listNodeTypes()).rejects.toMatchObject({
            name: 'ApiClientError',
            kind: 'network',
            status: null,
            message: 'Request timed out after 20ms',
        } satisfies Partial<ApiClientError>);
    });

    it('loads node types via listNodeTypes (normal path)', async () => {
        const client = createApiClient({baseUrl: 'http://127.0.0.1:8000'});
        const payload = await client.listNodeTypes();

        expect(payload.count).toBe(2);
        expect(payload.items[0]?.type_name).toBe('mock.input');
    });

    it('submits graph and returns validation report (normal path)', async () => {
        server.use(
            http.post('*/api/v1/graphs/validate', async ({request}) => {
                const requestBody = (await request.json()) as GraphSpec;
                return HttpResponse.json({
                    graph_id: requestBody.graph_id,
                    valid: true,
                    issues: [],
                });
            }),
        );

        const client = createApiClient({baseUrl: 'http://127.0.0.1:8000'});
        const report = await client.validateGraph(graphFixture);

        expect(report.graph_id).toBe('graph_t1');
        expect(report.valid).toBe(true);
        expect(report.issues).toHaveLength(0);
    });

    it('maps backend 422 to ApiClientError(http) with readable message (error path)', async () => {
        server.use(
            http.post('*/api/v1/runs', () =>
                HttpResponse.json(
                    {
                        detail: {
                            message: 'Graph validation failed before execution',
                        },
                    },
                    {
                        status: 422,
                    },
                ),
            ),
        );

        const client = createApiClient({baseUrl: 'http://127.0.0.1:8000'});

        await expect(
            client.createRun({
                graph: graphFixture,
                stream_id: 'stream_t1',
            }),
        ).rejects.toMatchObject({
            name: 'ApiClientError',
            kind: 'http',
            status: 422,
            message: 'Graph validation failed before execution',
        } satisfies Partial<ApiClientError>);
    });

    it('builds events query params correctly in getRunEvents (edge path)', async () => {
        let capturedUrl = '';

        server.use(
            http.get('*/api/v1/runs/:runId/events', ({request, params}) => {
                capturedUrl = request.url;
                return HttpResponse.json({
                    run_id: params.runId,
                    next_cursor: 10,
                    count: 0,
                    items: [],
                });
            }),
        );

        const client = createApiClient({baseUrl: 'http://127.0.0.1:8000'});
        await client.getRunEvents('run_query_t1', {
            since: 2,
            limit: 15,
            event_type: 'node_failed',
            node_id: 'n4',
            severity: 'error',
            error_code: 'node.execution_failed',
        });

        const parsed = new URL(capturedUrl);
        expect(parsed.searchParams.get('since')).toBe('2');
        expect(parsed.searchParams.get('limit')).toBe('15');
        expect(parsed.searchParams.get('event_type')).toBe('node_failed');
        expect(parsed.searchParams.get('node_id')).toBe('n4');
        expect(parsed.searchParams.get('severity')).toBe('error');
        expect(parsed.searchParams.get('error_code')).toBe('node.execution_failed');
    });

    it('throws parse error when backend returns non-json body on success (edge path)', async () => {
        server.use(
            http.get('*/api/v1/node-types', () =>
                new HttpResponse('not-a-json-body', {
                    status: 200,
                    headers: {
                        'Content-Type': 'text/plain',
                    },
                }),
            ),
        );

        const client = createApiClient({baseUrl: 'http://127.0.0.1:8000'});

        await expect(client.listNodeTypes()).rejects.toMatchObject({
            name: 'ApiClientError',
            kind: 'parse',
            status: 200,
        } satisfies Partial<ApiClientError>);
    });

    it('supports graph persistence CRUD endpoints (normal path)', async () => {
        const graphSaved: GraphSpec = {
            ...graphFixture,
            graph_id: 'graph_saved_t1',
            nodes: [
                {
                    node_id: 'n1',
                    type_name: 'mock.input',
                    title: 'Input',
                    config: {},
                },
            ],
        };

        server.use(
            http.get('*/api/v1/graphs', () =>
                HttpResponse.json({
                    count: 1,
                    items: [
                        {
                            graph_id: 'graph_saved_t1',
                            version: '0.1.0',
                            updated_at: 1_700_000_000.0,
                        },
                    ],
                }),
            ),
            http.put('*/api/v1/graphs/:graphId', ({params}) =>
                HttpResponse.json({
                    graph_id: params.graphId,
                    version: '0.1.0',
                    updated_at: 1_700_000_001.0,
                }),
            ),
            http.get('*/api/v1/graphs/:graphId', ({params}) =>
                HttpResponse.json({
                    ...graphSaved,
                    graph_id: params.graphId,
                }),
            ),
            http.delete('*/api/v1/graphs/:graphId', ({params}) =>
                HttpResponse.json({
                    graph_id: params.graphId,
                    deleted: true,
                }),
            ),
        );

        const client = createApiClient({baseUrl: 'http://127.0.0.1:8000'});
        const listed = await client.listGraphs();
        expect(listed.count).toBe(1);
        expect(listed.items[0]?.graph_id).toBe('graph_saved_t1');

        const saved = await client.saveGraph(graphSaved);
        expect(saved.graph_id).toBe('graph_saved_t1');

        const loaded = await client.getGraph('graph_saved_t1');
        expect(loaded.graph_id).toBe('graph_saved_t1');
        expect(loaded.nodes).toHaveLength(1);

        const deleted = await client.deleteGraph('graph_saved_t1');
        expect(deleted.deleted).toBe(true);
        expect(deleted.graph_id).toBe('graph_saved_t1');
    });

    it('builds websocket URL with secure protocol and filters (normal + edge)', () => {
        const client = createApiClient({baseUrl: 'https://api.starryai.test/'});
        const wsUrl = client.buildRunEventsWsUrl('run_ws_t1', {
            since: 9,
            event_type: 'sync_frame_emitted',
            severity: 'warning',
        });

        expect(wsUrl).toBe(
            'wss://api.starryai.test/api/v1/runs/run_ws_t1/events?since=9&event_type=sync_frame_emitted&severity=warning',
        );
    });

    it('rejects blank stream_id before sending createRun request (edge path)', async () => {
        const client = createApiClient({baseUrl: 'http://127.0.0.1:8000'});

        expect(() =>
            client.createRun({
                graph: graphFixture,
                stream_id: '   ',
            }),
        ).toThrowError('stream_id cannot be empty');
    });
});
