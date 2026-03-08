import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {http, HttpResponse} from 'msw';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {SecretManagerPanel} from '../../src/features/settings/SecretManagerPanel';
import {resetSecretStore} from '../../src/shared/state/secret-store';
import {server} from '../mocks/server';

describe('SecretManagerPanel', () => {
    beforeEach(() => {
        resetSecretStore();
        vi.restoreAllMocks();
    });

    it('loads secrets and creates a new secret without exposing raw value', async () => {
        const items = [
            {
                secret_id: 'openai-main',
                label: 'OpenAI Main',
                kind: 'api_key',
                description: 'Primary key',
                provider: 'memory',
                created_at: 1_700_000_000,
                updated_at: 1_700_000_000,
                usage_count: 0,
                in_use: false,
            },
        ];

        server.use(
            http.get('*/api/v1/secrets', () =>
                HttpResponse.json({
                    count: items.length,
                    items,
                }),
            ),
            http.post('*/api/v1/secrets', async ({request}) => {
                const body = (await request.json()) as Record<string, string | null>;
                const created = {
                    secret_id: body.secret_id ?? 'audio-main',
                    label: body.label ?? 'Audio Main',
                    kind: body.kind ?? 'generic',
                    description: body.description ?? '',
                    provider: 'memory',
                    created_at: 1_700_000_010,
                    updated_at: 1_700_000_010,
                    usage_count: 0,
                    in_use: false,
                };
                items.push(created);
                return HttpResponse.json(created, {status: 201});
            }),
        );

        render(<SecretManagerPanel/>);

        expect(await screen.findByText('OpenAI Main')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', {name: '新建 Secret'}));
        const dialog = screen.getByRole('dialog', {name: '新建 Secret'});
        fireEvent.change(within(dialog).getByLabelText('名称'), {target: {value: 'Audio Main'}});
        fireEvent.change(within(dialog).getByLabelText('类型'), {target: {value: 'device_token'}});
        fireEvent.change(within(dialog).getByLabelText('Secret ID（可选）'), {target: {value: 'audio-main'}});
        fireEvent.change(within(dialog).getByLabelText('描述'), {target: {value: 'Audio device token'}});
        fireEvent.change(within(dialog).getByLabelText('Secret 值'), {target: {value: 'raw-audio-token'}});
        fireEvent.click(within(dialog).getByRole('button', {name: '保存'}));

        expect(await screen.findByText('Audio Main')).toBeTruthy();
        expect(screen.queryByText('raw-audio-token')).toBeNull();
        expect(screen.getByText('共 2 个 Secret')).toBeTruthy();
    });

    it('shows backend delete conflict when secret is still referenced', async () => {
        const items = [
            {
                secret_id: 'openai-main',
                label: 'OpenAI Main',
                kind: 'api_key',
                description: 'Primary key',
                provider: 'memory',
                created_at: 1_700_000_000,
                updated_at: 1_700_000_000,
                usage_count: 1,
                in_use: true,
            },
        ];

        vi.spyOn(window, 'confirm').mockReturnValue(true);

        server.use(
            http.get('*/api/v1/secrets', () =>
                HttpResponse.json({
                    count: items.length,
                    items,
                }),
            ),
            http.delete('*/api/v1/secrets/:secretId', ({params}) =>
                HttpResponse.json(
                    {
                        detail: {
                            message: `secret 仍被引用，禁止删除: ${params.secretId}`,
                        },
                    },
                    {status: 409},
                ),
            ),
        );

        render(<SecretManagerPanel/>);

        const title = await screen.findByText('OpenAI Main');
        const card = title.closest('article');
        expect(card).toBeTruthy();

        fireEvent.click(within(card as HTMLElement).getByRole('button', {name: '删除'}));

        await waitFor(() => {
            expect(screen.getByTestId('secret-manager-error').textContent).toContain('禁止删除');
        });
    });
});
