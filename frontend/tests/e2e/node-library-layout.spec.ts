import {expect, test, type Locator, type Page} from '@playwright/test';

const NODE_TYPES_WITH_LONG_PORT_TEXT = [
    {
        type_name: 'data.requester',
        version: '0.1.0',
        mode: 'async',
        inputs: [
            {
                name: 'source',
                frame_schema: 'any',
                is_stream: false,
                required: true,
                description: 'Reference binding to the source data container.',
            },
            {
                name: 'trigger',
                frame_schema: 'any',
                is_stream: false,
                required: true,
                description: 'Trigger input used to request container data.',
            },
        ],
        outputs: [
            {
                name: 'value',
                frame_schema: 'any',
                is_stream: false,
                required: true,
                description: 'Current container value.',
            },
        ],
        sync_config: null,
        config_schema: {},
        description: 'Request current data from a passive container when triggered.',
        tags: ['data_requester'],
    },
    {
        type_name: 'data.writer',
        version: '0.1.0',
        mode: 'async',
        inputs: [
            {
                name: 'in',
                frame_schema: 'any',
                is_stream: false,
                required: true,
                description: 'Trigger payload used by the configured write operation.',
            },
        ],
        outputs: [],
        sync_config: null,
        config_schema: {},
        description: 'Write to a passive data container with configured side effects.',
        tags: ['data_writer'],
    },
    {
        type_name: 'audio.play.base',
        version: '0.1.0',
        mode: 'async',
        inputs: [
            {
                name: 'in',
                frame_schema: 'audio.full',
                is_stream: false,
                required: true,
                description: 'Incoming audio payload.',
            },
        ],
        outputs: [],
        sync_config: null,
        config_schema: {},
        description: 'Base audio executor node that runs immediately when it receives input.',
    },
] as const;

const installNodeLibraryMocks = async (page: Page) => {
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
                    count: NODE_TYPES_WITH_LONG_PORT_TEXT.length,
                    items: NODE_TYPES_WITH_LONG_PORT_TEXT,
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

const expectInsideCard = async (card: Locator, target: Locator, label: string) => {
    const cardBox = await getBoundingBox(card, 'node library card');
    const targetBox = await getBoundingBox(target, label);

    expect(targetBox.x, `${label} should stay inside the card on the left`).toBeGreaterThanOrEqual(cardBox.x - 1);
    expect(targetBox.y, `${label} should stay inside the card on the top`).toBeGreaterThanOrEqual(cardBox.y - 1);
    expect(targetBox.x + targetBox.width, `${label} should stay inside the card on the right`).toBeLessThanOrEqual(
        cardBox.x + cardBox.width + 1,
    );
    expect(targetBox.y + targetBox.height, `${label} should stay inside the card on the bottom`).toBeLessThanOrEqual(
        cardBox.y + cardBox.height + 1,
    );
};

const expectNoHorizontalOverflow = async (locator: Locator, label: string) => {
    await expect
        .poll(
            async () =>
                locator.evaluate((element) => {
                    const htmlElement = element as HTMLElement;
                    return htmlElement.scrollWidth <= htmlElement.clientWidth + 1;
                }),
            {message: `${label} should not overflow horizontally`},
        )
        .toBe(true);
};

test('keeps node library cards aligned for long port descriptions', async ({page}) => {
    await page.setViewportSize({width: 1440, height: 1280});
    await installNodeLibraryMocks(page);

    await page.goto('/');
    await page.getByTitle('新增节点').click();

    const drawer = page.getByLabel('node-library-drawer');
    await expect(drawer).toBeVisible();
    await expectNoHorizontalOverflow(drawer, 'node library drawer');

    const requesterCard = drawer.locator('article').filter({hasText: 'data.requester'});
    await expect(requesterCard).toBeVisible();
    await expect(requesterCard.locator('.react-flow__handle')).toHaveCount(0);
    await expectNoHorizontalOverflow(requesterCard, 'data.requester card');

    const requesterRows = requesterCard.locator('[data-testid^="drawer-port-tag-"]');
    const requesterRowCount = await requesterRows.count();
    expect(requesterRowCount, 'data.requester should render its input/output rows').toBeGreaterThan(0);
    for (let index = 0; index < requesterRowCount; index += 1) {
        await expectInsideCard(requesterCard, requesterRows.nth(index), `data.requester port row ${index + 1}`);
    }

    const writerCard = drawer.locator('article').filter({hasText: 'data.writer'});
    await expect(writerCard).toBeVisible();
    await expectNoHorizontalOverflow(writerCard, 'data.writer card');
    await expectInsideCard(writerCard, writerCard.getByTestId('drawer-port-tag-in-in'), 'data.writer input row');

    const audioCard = drawer.locator('article').filter({hasText: 'audio.play.base'});
    await expect(audioCard).toBeVisible();
    await expectNoHorizontalOverflow(audioCard, 'audio.play.base card');
    await expectInsideCard(audioCard, audioCard.getByTestId('drawer-port-tag-in-in'), 'audio.play.base input row');
});
