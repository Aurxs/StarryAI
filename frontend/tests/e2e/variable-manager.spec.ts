import {expect, test, type Page} from '@playwright/test';

import type {NodeSpec} from '../../src/entities/workbench/types';

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
] as const;

const installVariableManagerMocks = async (page: Page) => {
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
                body: JSON.stringify({count: 0, items: []}),
            });
            return;
        }

        if (method === 'POST' && path === '/api/v1/graphs/validate') {
            const body = (await request.postDataJSON()) as {graph_id?: string};
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    graph_id: body.graph_id ?? 'graph_new',
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
};

test('creates and deletes a variable from the variable manager', async ({page}) => {
    await installVariableManagerMocks(page);

    await page.goto('/');
    await page.getByTestId('graph-editor-open-variable-manager').click();

    const drawer = page.getByTestId('variable-manager-drawer');
    await expect(drawer).toBeVisible();
    await expect(page.getByTestId('variable-manager-create-overlay')).toBeVisible();

    await page.getByTestId('variable-manager-name-input').fill('session_count');
    await page.getByTestId('variable-manager-type-select').selectOption('scalar.int');
    await page.getByTestId('variable-manager-scalar-input').fill('3');
    await page.getByTestId('variable-manager-save-button').click();

    await expect(page.getByTestId('variable-manager-success')).toContainText('变量已创建');
    await expect(page.getByTestId('variable-manager-floating-item-session_count')).toBeVisible();
    await expect(page.getByTestId('variable-manager-usage-empty')).toContainText('当前条目暂无引用');

    await page.getByTestId('variable-manager-delete-button').click();

    await expect(page.getByTestId('variable-manager-success')).toContainText('变量已删除');
    await expect(page.getByTestId('variable-manager-empty')).toBeVisible();
    await expect(page.getByTestId('variable-manager-create-overlay')).toBeVisible();
});

test('keeps constants read-only after creation in the variable manager', async ({page}) => {
    await installVariableManagerMocks(page);

    await page.goto('/');
    await page.getByTestId('graph-editor-open-variable-manager').click();

    await page.getByTestId('variable-manager-name-input').fill('api_base_url');
    await page.getByTestId('variable-manager-kind-select').selectOption('constant');
    await page.getByTestId('variable-manager-type-select').selectOption('scalar.string');
    await page.getByTestId('variable-manager-scalar-input').fill('https://api.example.com');
    await page.getByTestId('variable-manager-save-button').click();

    await expect(page.getByTestId('variable-manager-readonly-hint')).toContainText('常量只能创建');
    await expect(page.getByTestId('variable-manager-name-readonly')).toHaveText('api_base_url');
    await expect(page.getByTestId('variable-manager-kind-readonly')).toContainText('常量');
    await expect(page.getByTestId('variable-manager-initial-readonly')).toContainText('https://api.example.com');
    await expect(page.getByTestId('variable-manager-delete-button')).toHaveCount(0);
});
