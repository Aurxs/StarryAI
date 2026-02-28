import {http, HttpResponse} from 'msw';
import {describe, expect, it} from 'vitest';

import {server} from '../mocks/server';

describe('MSW baseline wiring', () => {
    it('returns a mocked node-types payload for normal API path', async () => {
        const response = await fetch('http://127.0.0.1:8000/api/v1/node-types');
        const payload = (await response.json()) as {
            count: number;
            items: Array<{ type_name: string }>;
        };

        expect(response.status).toBe(200);
        expect(payload.count).toBe(2);
        expect(payload.items[0]?.type_name).toBe('mock.input');
    });

    it('returns 404 for unknown API endpoints (edge path)', async () => {
        const response = await fetch('http://127.0.0.1:8000/api/v1/unknown-endpoint');
        const payload = (await response.json()) as { message: string };

        expect(response.status).toBe(404);
        expect(payload.message).toBe('not found');
    });

    it('supports per-test handler override for backend failure simulation', async () => {
        server.use(
            http.get('*/api/v1/node-types', () =>
                HttpResponse.json(
                    {detail: 'backend unavailable'},
                    {
                        status: 503,
                    },
                ),
            ),
        );

        const response = await fetch('http://127.0.0.1:8000/api/v1/node-types');
        const payload = (await response.json()) as { detail: string };

        expect(response.status).toBe(503);
        expect(payload.detail).toBe('backend unavailable');
    });
});
