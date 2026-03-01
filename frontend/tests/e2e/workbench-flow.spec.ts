import {expect, test} from '@playwright/test';

test('completes add-node -> auto-review -> run flow with fixed stream id', async ({page}) => {
    let runStatusCalls = 0;
    let capturedCreateBody: unknown = null;

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
                                description: '',
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
                                description: '',
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
                    valid: true,
                    issues: [],
                }),
            });
            return;
        }

        if (method === 'POST' && path === '/api/v1/runs') {
            capturedCreateBody = await request.postDataJSON();
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    run_id: 'run_e2e_new',
                    graph_id: 'graph_phase_e',
                    status: 'running',
                }),
            });
            return;
        }

        if (method === 'GET' && path === '/api/v1/runs/run_e2e_new') {
            runStatusCalls += 1;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    run_id: 'run_e2e_new',
                    graph_id: 'graph_phase_e',
                    status: runStatusCalls > 1 ? 'completed' : 'running',
                    created_at: 1_700_000_000,
                    started_at: 1_700_000_001,
                    ended_at: runStatusCalls > 1 ? 1_700_000_002 : null,
                    stream_id: 'stream_frontend',
                    last_error: null,
                    task_done: runStatusCalls > 1,
                    metrics: {},
                    node_states: {},
                    edge_states: [],
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

    await page.getByTitle('新增节点').click();
    await page.locator('article').filter({hasText: 'mock.input'}).first().click();
    await page.getByTitle('新增节点').click();
    await page.locator('article').filter({hasText: 'mock.output'}).first().click();

    await expect(page.getByTestId('review-bar')).toContainText('无问题');
    await expect(page.getByRole('button', {name: '测试运行'})).toBeEnabled();

    await page.getByRole('button', {name: '测试运行'}).click();
    await expect(page.getByText('运行状态: 已完成')).toBeVisible();
    expect((capturedCreateBody as { stream_id?: string } | null)?.stream_id).toBe('stream_frontend');

    await page.getByRole('button', {name: '打开操作历史'}).click();
    await expect(page.getByLabel('history-drawer')).toContainText('新增节点');
});

test('blocks run when review has error and shows issue drawer', async ({page}) => {
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
                    count: 1,
                    items: [
                        {
                            type_name: 'mock.output',
                            version: '0.1.0',
                            mode: 'async',
                            inputs: [{
                                name: 'in',
                                frame_schema: 'any',
                                is_stream: false,
                                required: true,
                                description: '',
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
                            code: 'node.required_input_unconnected',
                            message: '节点 n1 必填输入口未连接: in',
                        },
                    ],
                }),
            });
            return;
        }

        if (method === 'POST' && path === '/api/v1/runs') {
            await route.fulfill({
                status: 500,
                contentType: 'application/json',
                body: JSON.stringify({detail: 'should not run'}),
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
    await page.getByTitle('新增节点').click();
    await page.locator('article').filter({hasText: 'mock.output'}).first().click();

    await expect(page.getByTestId('review-bar')).toContainText('有1个问题');
    await expect(page.getByRole('button', {name: '测试运行'})).toBeDisabled();

    await page.getByTestId('review-bar').click();
    await expect(page.getByLabel('review-drawer')).toContainText('node.required_input_unconnected');
});
