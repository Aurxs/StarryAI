import {expect, test} from '@playwright/test';

test('creates secret, binds it to real llm node, saves graph, and runs with secret refs only', async ({page}) => {
    let runStatusCalls = 0;
    let validateCalls = 0;
    let capturedSaveBody: Record<string, unknown> | null = null;
    let capturedRunBody: Record<string, unknown> | null = null;
    const savedGraphs: Array<{graph_id: string; version: string; updated_at: number}> = [];
    const secrets: Array<Record<string, unknown>> = [];

    await page.route('http://127.0.0.1:8000/**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const method = request.method();
        const path = url.pathname;

        if (method === 'GET' && path === '/api/v1/graphs') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    count: savedGraphs.length,
                    items: savedGraphs,
                }),
            });
            return;
        }

        if (method === 'PUT' && path.startsWith('/api/v1/graphs/')) {
            capturedSaveBody = (await request.postDataJSON()) as Record<string, unknown>;
            const graphId = String(capturedSaveBody.graph_id ?? url.pathname.split('/').at(-1) ?? 'graph_real_llm');
            const record = {
                graph_id: graphId,
                version: '0.1.0',
                updated_at: 1_700_000_100,
            };
            const existingIndex = savedGraphs.findIndex((item) => item.graph_id === graphId);
            if (existingIndex >= 0) {
                savedGraphs[existingIndex] = record;
            } else {
                savedGraphs.push(record);
            }
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(record),
            });
            return;
        }

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
                            type_name: 'llm.openai_compatible',
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
                            config_schema: {
                                type: 'object',
                                properties: {
                                    model: {
                                        type: 'string',
                                        title: 'Model',
                                        default: 'gpt-4o-mini',
                                        enum: ['gpt-4o-mini', 'gpt-4.1-mini'],
                                        'x-starryai-order': 10,
                                    },
                                    api_key: {
                                        title: 'API Key',
                                        description: 'Bind a secret',
                                        anyOf: [{type: 'string'}, {type: 'null'}],
                                        default: null,
                                        'x-starryai-secret': true,
                                        'x-starryai-widget': 'secret',
                                        'x-starryai-order': 20,
                                    },
                                    system_prompt: {
                                        type: 'string',
                                        title: 'System Prompt',
                                        default: 'You are StarryAI.',
                                        'x-starryai-widget': 'textarea',
                                        'x-starryai-order': 30,
                                    },
                                },
                            },
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

        if (method === 'GET' && path === '/api/v1/secrets') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    count: secrets.length,
                    items: secrets,
                }),
            });
            return;
        }

        if (method === 'POST' && path === '/api/v1/secrets') {
            const body = (await request.postDataJSON()) as Record<string, string | null>;
            const created = {
                secret_id: body.secret_id ?? 'openai-main',
                label: body.label ?? 'OpenAI Main',
                kind: body.kind ?? 'api_key',
                description: body.description ?? '',
                provider: 'memory',
                created_at: 1_700_000_010,
                updated_at: 1_700_000_010,
                usage_count: 0,
                in_use: false,
            };
            secrets.push(created);
            await route.fulfill({
                status: 201,
                contentType: 'application/json',
                body: JSON.stringify(created),
            });
            return;
        }

        if (method === 'POST' && path === '/api/v1/graphs/validate') {
            validateCalls += 1;
            const body = (await request.postDataJSON()) as Record<string, unknown>;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    graph_id: body.graph_id ?? 'graph_real_llm',
                    valid: true,
                    issues: [],
                }),
            });
            return;
        }

        if (method === 'POST' && path === '/api/v1/runs') {
            capturedRunBody = (await request.postDataJSON()) as Record<string, unknown>;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    run_id: 'run_real_llm_e2e',
                    graph_id: 'graph_real_llm',
                    status: 'running',
                }),
            });
            return;
        }

        if (method === 'GET' && path === '/api/v1/runs/run_real_llm_e2e') {
            runStatusCalls += 1;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    run_id: 'run_real_llm_e2e',
                    graph_id: 'graph_real_llm',
                    status: runStatusCalls > 1 ? 'completed' : 'running',
                    created_at: 1_700_000_100,
                    started_at: 1_700_000_101,
                    ended_at: runStatusCalls > 1 ? 1_700_000_102 : null,
                    stream_id: 'stream_frontend',
                    last_error: null,
                    task_done: runStatusCalls > 1,
                    metrics: {},
                    node_states: {
                        n2: {
                            node_id: 'n2',
                            status: runStatusCalls > 1 ? 'finished' : 'running',
                            started_at: 1_700_000_101,
                            finished_at: runStatusCalls > 1 ? 1_700_000_102 : null,
                            last_error: null,
                            metrics: {
                                llm_model: 'gpt-4o-mini',
                                llm_total_tokens: 19,
                            },
                        },
                    },
                    edge_states: [],
                }),
            });
            return;
        }

        if (method === 'GET' && path === '/api/v1/runs/run_real_llm_e2e/metrics') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    run_id: 'run_real_llm_e2e',
                    graph_id: 'graph_real_llm',
                    status: 'completed',
                    created_at: 1_700_000_100,
                    started_at: 1_700_000_101,
                    ended_at: 1_700_000_102,
                    task_done: true,
                    graph_metrics: {},
                    node_metrics: {
                        n2: {
                            llm_model: 'gpt-4o-mini',
                            llm_total_tokens: 19,
                        },
                    },
                    edge_metrics: [],
                }),
            });
            return;
        }

        if (method === 'GET' && path === '/api/v1/runs/run_real_llm_e2e/diagnostics') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    run_id: 'run_real_llm_e2e',
                    graph_id: 'graph_real_llm',
                    status: 'completed',
                    created_at: 1_700_000_100,
                    started_at: 1_700_000_101,
                    ended_at: 1_700_000_102,
                    task_done: true,
                    failed_nodes: [],
                    slow_nodes_top: [],
                    edge_hotspots_top: [],
                    event_window: {
                        event_total: 1,
                    },
                    capacity: {
                        retained_runs: 1,
                    },
                }),
            });
            return;
        }

        if (method === 'GET' && path === '/api/v1/runs/run_real_llm_e2e/events') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    run_id: 'run_real_llm_e2e',
                    next_cursor: 0,
                    count: 0,
                    items: [],
                }),
            });
            return;
        }

        await route.fulfill({
            status: 404,
            contentType: 'application/json',
            body: JSON.stringify({detail: `not mocked: ${method} ${path}`}),
        });
    });

    await page.goto('/');

    await page.getByRole('button', {name: '设置'}).click();
    const settingsDialog = page.getByRole('dialog', {name: '设置'});
    await settingsDialog.getByRole('button', {name: '新建密钥'}).click();

    const secretDialog = page.getByRole('dialog', {name: '新建密钥'});
    await secretDialog.getByLabel('名称').fill('OpenAI Main');
    await secretDialog.getByLabel('类型').fill('api_key');
    await secretDialog.getByLabel('密钥值').fill('sk-openai-real-value');
    await secretDialog.getByRole('button', {name: '保存'}).click();

    await expect(settingsDialog).toContainText('OpenAI Main');
    await settingsDialog.getByRole('button', {name: '关闭'}).click();

    const addNode = async (typeName: string) => {
        await page.getByTitle('新增节点').click();
        await page.locator('article').filter({hasText: typeName}).first().click();
    };

    await addNode('mock.input');
    await addNode('llm.openai_compatible');
    await addNode('mock.output');

    await page.getByTestId('workflow-node-n2').evaluate((element) => {
        (element as HTMLElement).click();
    });
    const inspector = page.getByLabel('node-inspector-drawer');
    await expect(inspector).toContainText('类型名: llm.openai_compatible');

    const apiKeyField = inspector.locator('[data-field-path="api_key"]');
    await apiKeyField.locator('select').selectOption('openai-main');
    await inspector.getByRole('button', {name: '保存'}).click();
    await expect.poll(() => validateCalls).toBeGreaterThan(0);
    await expect(page.getByTestId('review-bar')).toContainText('无问题');

    const expandButton = page.getByTestId('graph-panel-expand');
    if (await expandButton.count()) {
        if (await expandButton.isVisible()) {
            await expandButton.click();
        }
    }

    const persistencePanel = page.getByTestId('graph-persistence-panel');
    await persistencePanel.getByRole('button', {name: '保存'}).click();

    await expect.poll(() => capturedSaveBody !== null).toBeTruthy();
    await expect(page.getByTestId('review-bar')).toContainText('无问题');

    const savedGraph = capturedSaveBody as {nodes?: Array<Record<string, unknown>>};
    const savedLlmNode = savedGraph.nodes?.find((node) => node.type_name === 'llm.openai_compatible');
    expect(savedLlmNode).toBeTruthy();
    expect(savedLlmNode?.config).toMatchObject({
        api_key: {
            $kind: 'secret_ref',
            secret_id: 'openai-main',
        },
    });
    expect(JSON.stringify(capturedSaveBody)).not.toContain('sk-openai-real-value');

    await expect(page.getByRole('button', {name: '测试运行'})).toBeEnabled();
    await page.getByRole('button', {name: '测试运行'}).click();
    await expect(page.getByText('运行状态: 已完成')).toBeVisible();

    const runGraph = (capturedRunBody as {graph?: {nodes?: Array<Record<string, unknown>>}} | null)?.graph;
    const runLlmNode = runGraph?.nodes?.find((node) => node.type_name === 'llm.openai_compatible');
    expect(runLlmNode).toBeTruthy();
    expect(runLlmNode?.config).toMatchObject({
        api_key: {
            $kind: 'secret_ref',
            secret_id: 'openai-main',
        },
    });
    expect(JSON.stringify(capturedRunBody)).not.toContain('sk-openai-real-value');
});
