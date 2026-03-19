import {expect, test, type Page} from '@playwright/test';

import type {GraphSpec, GraphSummary, NodeSpec} from '../../src/entities/workbench/types';

const MOCK_NODE_TYPES: NodeSpec[] = [
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
] as const;

const graphSummaryFromSpec = (graph: GraphSpec, updatedAt: number): GraphSummary => ({
    graph_id: graph.graph_id,
    version: graph.version,
    updated_at: updatedAt,
});

const installPersistenceMocks = async (page: Page) => {
    const storedGraphs = new Map<string, GraphSpec>();
    const savedGraphs: GraphSummary[] = [
        {
            graph_id: 'graph_new',
            version: '0.1.0',
            updated_at: 1_700_000_000,
        },
    ];
    let capturedSaveBody: GraphSpec | null = null;

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
                    count: MOCK_NODE_TYPES.length,
                    items: MOCK_NODE_TYPES,
                }),
            });
            return;
        }

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
            capturedSaveBody = (await request.postDataJSON()) as GraphSpec;
            storedGraphs.set(capturedSaveBody.graph_id, capturedSaveBody);

            const summary = graphSummaryFromSpec(capturedSaveBody, 1_700_000_100 + savedGraphs.length);
            const existingIndex = savedGraphs.findIndex((item) => item.graph_id === summary.graph_id);
            if (existingIndex >= 0) {
                savedGraphs[existingIndex] = summary;
            } else {
                savedGraphs.push(summary);
            }

            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(summary),
            });
            return;
        }

        if (method === 'GET' && path.startsWith('/api/v1/graphs/')) {
            const graphId = decodeURIComponent(path.split('/').at(-1) ?? '');
            const stored = storedGraphs.get(graphId);
            if (!stored) {
                await route.fulfill({
                    status: 404,
                    contentType: 'application/json',
                    body: JSON.stringify({detail: 'graph not found'}),
                });
                return;
            }
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(stored),
            });
            return;
        }

        if (method === 'DELETE' && path.startsWith('/api/v1/graphs/')) {
            const graphId = decodeURIComponent(path.split('/').at(-1) ?? '');
            storedGraphs.delete(graphId);
            const existingIndex = savedGraphs.findIndex((item) => item.graph_id === graphId);
            if (existingIndex >= 0) {
                savedGraphs.splice(existingIndex, 1);
            }
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    graph_id: graphId,
                    deleted: true,
                }),
            });
            return;
        }

        if (method === 'POST' && path === '/api/v1/graphs/validate') {
            const body = (await request.postDataJSON()) as GraphSpec;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    graph_id: body.graph_id,
                    valid: true,
                    issues: [],
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

    return {
        getCapturedSaveBody: () => capturedSaveBody,
    };
};

test('saves, reloads, and deletes a graph from the persistence panel', async ({page}) => {
    const mocks = await installPersistenceMocks(page);

    await page.goto('/');

    await expect(page.getByTestId('project-name-display')).toHaveText('graph_new_1');

    await page.getByTitle('新增节点').click();
    await page.locator('article').filter({hasText: 'mock.input'}).first().click();
    await expect(page.getByTestId('workflow-node-n1')).toBeVisible();
    await expect(page.getByTestId('review-bar')).toContainText('无问题');

    await page.getByTestId('graph-panel-expand').click();
    await page.getByRole('button', {name: '保存'}).click();

    await expect
        .poll(() => mocks.getCapturedSaveBody()?.graph_id ?? null, {
            message: 'graph save request should include the auto-renamed graph id',
        })
        .toBe('graph_new_1');
    expect(mocks.getCapturedSaveBody()?.nodes).toHaveLength(1);

    const savedGraphItem = page.locator('[data-testid="saved-graphs-list"] li').filter({hasText: 'graph_new_1'});
    await expect(savedGraphItem).toBeVisible();

    await page.getByTestId('graph-panel-collapse').click();
    await page.getByTitle('新增节点').click();
    await page.locator('article').filter({hasText: 'mock.output'}).first().click();
    await expect(page.getByTestId('workflow-node-n2')).toBeVisible();

    await page.getByTestId('graph-panel-expand').click();
    page.once('dialog', (dialog) => dialog.accept());
    await savedGraphItem.getByRole('button', {name: '加载'}).click();

    await expect(page.getByTestId('workflow-node-n1')).toBeVisible();
    await expect(page.getByTestId('workflow-node-n2')).toHaveCount(0);
    await expect(page.getByTestId('project-name-display')).toHaveText('graph_new_1');

    page.once('dialog', (dialog) => dialog.accept());
    await savedGraphItem.getByRole('button', {name: '删除'}).click();

    await expect(page.locator('[data-testid="saved-graphs-list"] li').filter({hasText: 'graph_new_1'})).toHaveCount(0);
    await expect(page.locator('[data-testid="saved-graphs-list"] li').filter({hasText: 'graph_new'})).toHaveCount(1);
});
