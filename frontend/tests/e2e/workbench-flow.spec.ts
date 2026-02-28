import {expect, test} from '@playwright/test';

test('completes validate-run-events-insights flow with mocked backend', async ({page}) => {
    let runStatusCalls = 0;
    let capturedEventsQuery = '';

    await page.route('http://127.0.0.1:8000/**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const method = request.method();
        const path = url.pathname;

        if (method === 'GET' && path === '/api/v1/node-types') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    count: 3,
                    items: [
                        {
                            type_name: 'mock.input',
                            version: '0.1.0',
                            mode: 'async',
                            inputs: [],
                            outputs: [
                                {
                                    name: 'text',
                                    frame_schema: 'text.final',
                                    is_stream: false,
                                    required: true,
                                    description: '',
                                },
                            ],
                            sync_config: null,
                            config_schema: {},
                            description: '',
                        },
                        {
                            type_name: 'mock.llm',
                            version: '0.1.0',
                            mode: 'async',
                            inputs: [
                                {
                                    name: 'prompt',
                                    frame_schema: 'text.final',
                                    is_stream: false,
                                    required: true,
                                    description: '',
                                },
                            ],
                            outputs: [
                                {
                                    name: 'answer',
                                    frame_schema: 'text.final',
                                    is_stream: false,
                                    required: true,
                                    description: '',
                                },
                            ],
                            sync_config: null,
                            config_schema: {},
                            description: '',
                        },
                        {
                            type_name: 'mock.output',
                            version: '0.1.0',
                            mode: 'async',
                            inputs: [
                                {
                                    name: 'in',
                                    frame_schema: 'any',
                                    is_stream: false,
                                    required: true,
                                    description: '',
                                },
                            ],
                            outputs: [],
                            sync_config: null,
                            config_schema: {},
                            description: '',
                        },
                    ],
                }),
            });
            return;
        }

        if (method === 'POST' && path === '/api/v1/graphs/validate') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    graph_id: 'graph_phase_e',
                    valid: true,
                    issues: [],
                }),
            });
            return;
        }

        if (method === 'POST' && path === '/api/v1/runs') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    run_id: 'run_e2e_flow',
                    graph_id: 'graph_phase_e',
                    status: 'running',
                }),
            });
            return;
        }

        if (method === 'GET' && path === '/api/v1/runs/run_e2e_flow') {
            runStatusCalls += 1;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    run_id: 'run_e2e_flow',
                    graph_id: 'graph_phase_e',
                    status: runStatusCalls > 1 ? 'completed' : 'running',
                    created_at: 1_700_000_000,
                    started_at: 1_700_000_001,
                    ended_at: runStatusCalls > 1 ? 1_700_000_002 : null,
                    stream_id: 'stream_e2e',
                    last_error: null,
                    task_done: runStatusCalls > 1,
                    metrics: {
                        event_total: 3,
                    },
                    node_states: {},
                    edge_states: [],
                }),
            });
            return;
        }

        if (method === 'GET' && path === '/api/v1/runs/run_e2e_flow/events') {
            capturedEventsQuery = url.search;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    run_id: 'run_e2e_flow',
                    next_cursor: 3,
                    count: 2,
                    items: [
                        {
                            run_id: 'run_e2e_flow',
                            event_id: 'run_e2e_flow:1',
                            event_seq: 1,
                            event_type: 'run_started',
                            severity: 'info',
                            component: 'scheduler',
                            ts: 1_700_000_010,
                            node_id: null,
                            edge_key: null,
                            error_code: null,
                            attempt: null,
                            message: 'run started',
                            details: {},
                        },
                        {
                            run_id: 'run_e2e_flow',
                            event_id: 'run_e2e_flow:2',
                            event_seq: 2,
                            event_type: 'node_finished',
                            severity: 'info',
                            component: 'node',
                            ts: 1_700_000_011,
                            node_id: 'n1',
                            edge_key: null,
                            error_code: null,
                            attempt: null,
                            message: 'node finished',
                            details: {},
                        },
                    ],
                }),
            });
            return;
        }

        if (method === 'GET' && path === '/api/v1/runs/run_e2e_flow/metrics') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    run_id: 'run_e2e_flow',
                    graph_id: 'graph_phase_e',
                    status: 'completed',
                    created_at: 1_700_000_000,
                    started_at: 1_700_000_001,
                    ended_at: 1_700_000_002,
                    task_done: true,
                    graph_metrics: {event_total: 3, node_finished: 2},
                    node_metrics: {n1: {}, n2: {}},
                    edge_metrics: [{edge: 'n1.text->n2.in', forwarded_frames: 1}],
                }),
            });
            return;
        }

        if (method === 'GET' && path === '/api/v1/runs/run_e2e_flow/diagnostics') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    run_id: 'run_e2e_flow',
                    graph_id: 'graph_phase_e',
                    status: 'completed',
                    task_done: true,
                    last_error: null,
                    failed_nodes: [],
                    slow_nodes_top: [{node_id: 'n1', duration_ms: 50}],
                    edge_hotspots_top: [{edge: 'n1.text->n2.in', queue_peak_size: 1}],
                }),
            });
            return;
        }

        await route.fulfill({
            status: 404,
            contentType: 'application/json',
            body: JSON.stringify({detail: 'not mocked'}),
        });
    });

    await page.goto('/');

    // Build a minimal graph by adding nodes from palette.
    await page.locator('[data-testid="graph-editor-shell"]').getByRole('button', {name: '添加'}).first().click();
    await page.locator('[data-testid="graph-editor-shell"]').getByRole('button', {name: '添加'}).nth(1).click();
    await expect(page.getByTestId('summary-node-count')).toContainText('2');

    // Validate graph.
    await page.getByRole('button', {name: '校验图'}).click();
    await expect(page.getByTestId('validation-summary')).toContainText('结果: 通过');

    // Start run and wait for completion through status polling.
    await page.getByLabel('stream-id-input').fill('stream_e2e');
    await page.getByRole('button', {name: '启动运行'}).click();
    await expect(page.getByTestId('run-control-summary')).toContainText('run_e2e_flow');
    await expect(page.getByTestId('run-control-summary')).toContainText('状态=已完成');

    // Apply filters and load events.
    await page.getByLabel('filter-event-type').selectOption('node_finished');
    await page.getByLabel('filter-severity').selectOption('info');
    await page.getByLabel('filter-node-id').fill('n1');
    await page.getByLabel('filter-error-code').fill('node.execution_failed');
    await page.getByRole('button', {name: '加载事件'}).click();

    await expect(page.getByTestId('runtime-console-summary')).toContainText('事件数=2');
    await expect(page.getByTestId('runtime-console-panel')).toContainText('node_finished @n1');
    expect(capturedEventsQuery).toContain('event_type=node_finished');
    expect(capturedEventsQuery).toContain('severity=info');
    expect(capturedEventsQuery).toContain('node_id=n1');
    expect(capturedEventsQuery).toContain('error_code=node.execution_failed');

    // Open run insights panel and verify metrics/diagnostics are rendered.
    await page.getByRole('button', {name: '运行洞察'}).click();
    await expect(page.getByTestId('run-insights-metrics')).toContainText('图指标键数量: 2');
    await expect(page.getByTestId('run-insights-diagnostics')).toContainText('慢节点 Top 数: 1');
});

test('shows validation and run errors when backend returns failure responses', async ({page}) => {
    await page.route('http://127.0.0.1:8000/**', async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        const method = request.method();

        if (method === 'GET' && path === '/api/v1/node-types') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    count: 2,
                    items: [
                        {
                            type_name: 'mock.input',
                            version: '0.1.0',
                            mode: 'async',
                            inputs: [],
                            outputs: [{
                                name: 'text',
                                frame_schema: 'text.final',
                                is_stream: false,
                                required: true,
                                description: ''
                            }],
                            sync_config: null,
                            config_schema: {},
                            description: '',
                        },
                        {
                            type_name: 'mock.output',
                            version: '0.1.0',
                            mode: 'async',
                            inputs: [{
                                name: 'in',
                                frame_schema: 'any',
                                is_stream: false,
                                required: true,
                                description: ''
                            }],
                            outputs: [],
                            sync_config: null,
                            config_schema: {},
                            description: '',
                        },
                    ],
                }),
            });
            return;
        }

        if (method === 'POST' && path === '/api/v1/graphs/validate') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    graph_id: 'graph_phase_e',
                    valid: false,
                    issues: [
                        {
                            level: 'error',
                            code: 'edge.schema_mismatch',
                            message: '边 schema 不兼容: n1.text -> n2.in',
                        },
                    ],
                }),
            });
            return;
        }

        if (method === 'POST' && path === '/api/v1/runs') {
            await route.fulfill({
                status: 422,
                contentType: 'application/json',
                body: JSON.stringify({
                    detail: {
                        message: 'Graph validation failed before execution',
                    },
                }),
            });
            return;
        }

        await route.fulfill({
            status: 404,
            contentType: 'application/json',
            body: JSON.stringify({detail: 'not mocked'}),
        });
    });

    await page.goto('/');

    await page.locator('[data-testid="graph-editor-shell"]').getByRole('button', {name: '添加'}).first().click();
    await page.locator('[data-testid="graph-editor-shell"]').getByRole('button', {name: '添加'}).nth(1).click();

    await page.getByRole('button', {name: '校验图'}).click();
    await expect(page.getByTestId('validation-summary')).toContainText('结果: 未通过');
    await expect(page.getByTestId('graph-validation-panel')).toContainText('edge.schema_mismatch');

    await page.getByRole('button', {name: '启动运行'}).click();
    await expect(page.getByTestId('run-control-error')).toContainText('启动运行失败');
    await expect(page.getByTestId('run-control-summary')).toContainText('状态=失败');
});
