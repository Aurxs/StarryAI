import {expect, test, type Locator, type Page} from '@playwright/test';

const DESKTOP_VIEWPORTS = [
    {width: 1920, height: 1080},
    {width: 2560, height: 1440},
] as const;

const MOCK_NODE_TYPES = [
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
];

const installWorkbenchMocks = async (page: Page) => {
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
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    graph_id: 'graph_new',
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

const getBoundingBox = async (locator: Locator, label: string) => {
    await expect(locator, `${label} should be visible before reading its bounding box`).toBeVisible();
    const box = await locator.boundingBox();
    expect(box, `${label} should have a bounding box`).not.toBeNull();
    return box!;
};

const expectInsideViewport = async (page: Page, locator: Locator, label: string) => {
    const viewport = page.viewportSize();
    expect(viewport, 'viewport should be available').not.toBeNull();
    const box = await getBoundingBox(locator, label);

    expect(box.x, `${label} should stay inside the viewport on the left`).toBeGreaterThanOrEqual(0);
    expect(box.y, `${label} should stay inside the viewport on the top`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `${label} should stay inside the viewport on the right`).toBeLessThanOrEqual(viewport!.width);
    expect(box.y + box.height, `${label} should stay inside the viewport on the bottom`).toBeLessThanOrEqual(viewport!.height);
};

const expectLeftOf = async (left: Locator, right: Locator, leftLabel: string, rightLabel: string, minGap = 0) => {
    const leftBox = await getBoundingBox(left, leftLabel);
    const rightBox = await getBoundingBox(right, rightLabel);

    expect(
        leftBox.x + leftBox.width,
        `${leftLabel} should stay to the left of ${rightLabel} with at least ${minGap}px gap`,
    ).toBeLessThanOrEqual(rightBox.x - minGap + 1);
};

for (const viewport of DESKTOP_VIEWPORTS) {
    test(`keeps desktop overlays aligned at ${viewport.width}px`, async ({page}) => {
        await page.setViewportSize(viewport);
        await installWorkbenchMocks(page);

        await page.goto('/');

        const persistencePanel = page.getByTestId('graph-persistence-panel');
        const quickTools = page.getByLabel('quick-tools');
        const runDock = page.getByTestId('run-dock');
        const reviewBar = page.getByTestId('review-bar');
        const zoomBar = page.getByTestId('zoom-control-bar');

        await expectInsideViewport(page, persistencePanel, 'graph persistence panel');
        await expectInsideViewport(page, quickTools, 'quick tools');
        await expectInsideViewport(page, runDock, 'run dock');
        await expectInsideViewport(page, reviewBar, 'review bar');
        await expectInsideViewport(page, zoomBar, 'zoom control bar');

        await page.getByTestId('graph-panel-expand').click();
        await expect(page.getByRole('button', {name: '保存'})).toBeVisible();
        await expectInsideViewport(page, persistencePanel, 'expanded graph persistence panel');
        await expectLeftOf(persistencePanel, runDock, 'expanded graph persistence panel', 'run dock', 8);

        await page.getByTitle('新增节点').click();
        const nodeLibraryDrawer = page.getByLabel('node-library-drawer');
        await expectInsideViewport(page, nodeLibraryDrawer, 'node library drawer');

        await page.locator('article').filter({hasText: 'mock.input'}).first().click();
        const workflowNode = page.getByTestId('workflow-node-n1');
        await expect(workflowNode).toBeVisible();
        await workflowNode.click();

        const inspectorDrawer = page.getByLabel('node-inspector-drawer');
        await expect(inspectorDrawer).toBeVisible();
        await page.waitForTimeout(250);
        await expectInsideViewport(page, inspectorDrawer, 'node inspector drawer');
        await expectLeftOf(runDock, inspectorDrawer, 'run dock', 'node inspector drawer', 8);
        await expectLeftOf(zoomBar, inspectorDrawer, 'zoom control bar', 'node inspector drawer', 8);

        await reviewBar.click();
        const reviewDrawer = page.getByLabel('review-drawer');
        await expectInsideViewport(page, reviewDrawer, 'review drawer');
        await expectLeftOf(reviewDrawer, inspectorDrawer, 'review drawer', 'node inspector drawer', 8);

        await page.getByRole('button', {name: '打开操作历史'}).click();
        const historyDrawer = page.getByLabel('history-drawer');
        await expectInsideViewport(page, historyDrawer, 'history drawer');
    });
}
