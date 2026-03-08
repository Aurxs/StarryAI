import {fireEvent, render, screen, within} from '@testing-library/react';
import {http, HttpResponse} from 'msw';
import {beforeEach, describe, expect, it} from 'vitest';

import {NodeConfigPanel} from '../../src/features/node-config/NodeConfigPanel';
import i18n from '../../src/shared/i18n/i18n';
import {resetGraphStore, useGraphStore} from '../../src/shared/state/graph-store';
import {server} from '../mocks/server';

describe('NodeConfigPanel', () => {
    beforeEach(() => {
        resetGraphStore();
    });

    it('shows empty-state prompt when no node is selected', () => {
        render(<NodeConfigPanel/>);

        expect(screen.getByTestId('node-config-empty').textContent).toContain(
            '请先在画布上选择一个节点',
        );
    });

    it('updates selected node title and config on save', () => {
        useGraphStore.getState().upsertNode({
            node_id: 'n1',
            type_name: 'mock.input',
            title: 'Input Node',
            config: {
                content: 'hello',
            },
        });
        useGraphStore.getState().selectNode('n1');

        render(<NodeConfigPanel/>);

        fireEvent.change(screen.getByTestId('node-config-title-input'), {
            target: {value: 'Input Node Updated'},
        });
        fireEvent.change(screen.getByTestId('node-config-json-input'), {
            target: {value: '{\n  "content": "world"\n}'},
        });
        fireEvent.click(screen.getByRole('button', {name: '保存'}));

        const state = useGraphStore.getState();
        const node = state.graph.nodes.find((item) => item.node_id === 'n1');
        expect(node?.title).toBe('Input Node Updated');
        expect(node?.config).toEqual({content: 'world'});
        expect(screen.queryByTestId('node-config-error')).toBeNull();
    });

    it('shows error for invalid json and keeps original config (edge path)', () => {
        useGraphStore.getState().upsertNode({
            node_id: 'n2',
            type_name: 'mock.output',
            title: 'Output Node',
            config: {
                enabled: true,
            },
        });
        useGraphStore.getState().selectNode('n2');

        render(<NodeConfigPanel/>);

        fireEvent.change(screen.getByTestId('node-config-json-input'), {
            target: {value: '{invalid'},
        });
        fireEvent.click(screen.getByRole('button', {name: '保存'}));

        expect(screen.getByTestId('node-config-error').textContent).toContain('配置 JSON 格式无效');
        const node = useGraphStore
            .getState()
            .graph.nodes.find((item) => item.node_id === 'n2');
        expect(node?.config).toEqual({enabled: true});
    });

    it('keeps sync fields readonly for executor and only saves runtime config', async () => {
        server.use(
            http.get('*/api/v1/node-types', () =>
                HttpResponse.json({
                    count: 1,
                    items: [
                        {
                            type_name: 'audio.play.sync',
                            version: '0.1.0',
                            mode: 'sync',
                            inputs: [
                                {
                                    name: 'in',
                                    frame_schema: 'audio.full.sync',
                                    is_stream: false,
                                    required: true,
                                    description: '',
                                },
                            ],
                            outputs: [],
                            sync_config: {
                                required_ports: ['in'],
                                strategy: 'barrier',
                                window_ms: 40,
                                late_policy: 'drop',
                                role: 'executor',
                                sync_group: 'av_group',
                                commit_lead_ms: 50,
                                ready_timeout_ms: 800,
                            },
                            config_schema: {},
                            description: '',
                        },
                    ],
                }),
            ),
        );

        useGraphStore.getState().upsertNode({
            node_id: 'n_sync',
            type_name: 'audio.play.sync',
            title: 'Audio Sync',
            config: {
                volume: 0.5,
                sync_group: 'group_from_initiator',
                sync_round: 6,
                ready_timeout_ms: 1600,
                commit_lead_ms: 120,
                __sync_managed_by: 'n_init_1',
            },
        });
        useGraphStore.getState().selectNode('n_sync');

        render(<NodeConfigPanel/>);

        const syncGroupInput = await screen.findByTestId('node-config-sync-group-input');
        expect((syncGroupInput as HTMLInputElement).disabled).toBe(true);
        expect((screen.getByTestId('node-config-sync-round-input') as HTMLInputElement).disabled).toBe(true);
        expect((screen.getByTestId('node-config-ready-timeout-input') as HTMLInputElement).disabled).toBe(true);
        expect((screen.getByTestId('node-config-commit-lead-input') as HTMLInputElement).disabled).toBe(true);

        fireEvent.change(screen.getByTestId('node-config-json-input'), {
            target: {value: '{\n  "volume": 0.8,\n  "channel": "L"\n}'},
        });
        fireEvent.click(screen.getByRole('button', {name: '保存'}));

        const node = useGraphStore.getState().graph.nodes.find((item) => item.node_id === 'n_sync');
        expect(node?.config).toEqual({
            volume: 0.8,
            channel: 'L',
            sync_group: 'group_from_initiator',
            sync_round: 6,
            ready_timeout_ms: 1600,
            commit_lead_ms: 120,
            __sync_managed_by: 'n_init_1',
        });
    });

    it('renders schema form and saves inline-created secret refs', async () => {
        server.use(
            http.get('*/api/v1/node-types', () =>
                HttpResponse.json({
                    count: 1,
                    items: [
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
                            config_schema: {
                                type: 'object',
                                properties: {
                                    model: {
                                        type: 'string',
                                        title: 'Model',
                                        default: 'mock-llm-v1',
                                        enum: ['mock-llm-v1', 'mock-llm-v2'],
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
                                },
                            },
                            description: '',
                        },
                    ],
                }),
            ),
            http.get('*/api/v1/secrets', () =>
                HttpResponse.json({
                    count: 0,
                    items: [],
                }),
            ),
            http.post('*/api/v1/secrets', async ({request}) => {
                const body = (await request.json()) as Record<string, string | null>;
                return HttpResponse.json(
                    {
                        secret_id: 'llm-inline',
                        label: body.label ?? 'LLM Inline',
                        kind: body.kind ?? 'generic',
                        description: body.description ?? '',
                        provider: 'memory',
                        created_at: 1_700_000_100,
                        updated_at: 1_700_000_100,
                        usage_count: 0,
                        in_use: false,
                    },
                    {status: 201},
                );
            }),
        );

        useGraphStore.getState().upsertNode({
            node_id: 'n_llm',
            type_name: 'mock.llm',
            title: 'Mock LLM',
            config: {},
        });
        useGraphStore.getState().selectNode('n_llm');

        render(<NodeConfigPanel/>);

        fireEvent.change(await screen.findByLabelText(/模型/), {
            target: {value: 'mock-llm-v2'},
        });

        const secretHeading = await screen.findByText('API 密钥');
        const secretSection = secretHeading.closest('[data-field-path="api_key"]');
        expect(secretSection).toBeTruthy();

        fireEvent.click(within(secretSection as HTMLElement).getByRole('button', {name: '新建密钥'}));
        fireEvent.change(within(secretSection as HTMLElement).getByLabelText('名称'), {
            target: {value: 'LLM Inline'},
        });
        fireEvent.change(within(secretSection as HTMLElement).getByLabelText('密钥值'), {
            target: {value: 'sk-inline-value'},
        });
        fireEvent.click(within(secretSection as HTMLElement).getByRole('button', {name: '创建并绑定'}));

        await screen.findByText('LLM Inline (llm-inline)');
        expect(within(secretSection as HTMLElement).getByText('类型: 通用')).toBeTruthy();
        expect(within(secretSection as HTMLElement).getByText('存储: 内存')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', {name: '保存'}));

        const node = useGraphStore.getState().graph.nodes.find((item) => item.node_id === 'n_llm');
        expect(node?.config).toMatchObject({
            model: 'mock-llm-v2',
            api_key: {
                $kind: 'secret_ref',
                secret_id: 'llm-inline',
            },
        });
        expect(JSON.stringify(node?.config)).not.toContain('sk-inline-value');
    });

    it('rejects plaintext secret values from advanced json save', async () => {
        server.use(
            http.get('*/api/v1/node-types', () =>
                HttpResponse.json({
                    count: 1,
                    items: [
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
                            config_schema: {
                                type: 'object',
                                properties: {
                                    api_key: {
                                        title: 'API Key',
                                        anyOf: [{type: 'string'}, {type: 'null'}],
                                        default: null,
                                        'x-starryai-secret': true,
                                        'x-starryai-widget': 'secret',
                                    },
                                },
                            },
                            description: '',
                        },
                    ],
                }),
            ),
            http.get('*/api/v1/secrets', () =>
                HttpResponse.json({
                    count: 0,
                    items: [],
                }),
            ),
        );

        useGraphStore.getState().upsertNode({
            node_id: 'n_llm_plaintext',
            type_name: 'mock.llm',
            title: 'Mock LLM',
            config: {},
        });
        useGraphStore.getState().selectNode('n_llm_plaintext');

        render(<NodeConfigPanel/>);

        await screen.findByText('API 密钥');
        fireEvent.change(screen.getByTestId('node-config-json-input'), {
            target: {value: '{\n  "api_key": "sk-plaintext"\n}'},
        });
        fireEvent.click(screen.getByRole('button', {name: '保存'}));

        expect(screen.getByTestId('node-config-error').textContent).toContain('不允许保存明文值');
        const node = useGraphStore.getState().graph.nodes.find((item) => item.node_id === 'n_llm_plaintext');
        expect(node?.config).toEqual({});
    });

    it('rejects invalid sync numeric fields (edge path)', async () => {
        server.use(
            http.get('*/api/v1/node-types', () =>
                HttpResponse.json({
                    count: 1,
                    items: [
                        {
                            type_name: 'sync.initiator.dual',
                            version: '0.1.0',
                            mode: 'sync',
                            inputs: [
                                {
                                    name: 'in_a',
                                    frame_schema: 'any',
                                    is_stream: false,
                                    required: true,
                                    description: '',
                                },
                                {
                                    name: 'in_b',
                                    frame_schema: 'any',
                                    is_stream: false,
                                    required: true,
                                    description: '',
                                },
                            ],
                            outputs: [
                                {
                                    name: 'out_a',
                                    frame_schema: 'any.sync',
                                    is_stream: false,
                                    required: true,
                                    description: '',
                                    derived_from_input: 'in_a',
                                },
                                {
                                    name: 'out_b',
                                    frame_schema: 'any.sync',
                                    is_stream: false,
                                    required: true,
                                    description: '',
                                    derived_from_input: 'in_b',
                                },
                            ],
                            sync_config: {
                                required_ports: ['in_a', 'in_b'],
                                strategy: 'barrier',
                                window_ms: 40,
                                late_policy: 'drop',
                                role: 'initiator',
                            },
                            config_schema: {},
                            description: '',
                        },
                    ],
                }),
            ),
        );

        useGraphStore.getState().upsertNode({
            node_id: 'n_init',
            type_name: 'sync.initiator.dual',
            title: 'Sync Initiator',
            config: {sync_group: 'g0', sync_round: 0},
        });
        useGraphStore.getState().selectNode('n_init');

        render(<NodeConfigPanel/>);

        await screen.findByTestId('node-config-sync-group-input');
        fireEvent.change(screen.getByTestId('node-config-ready-timeout-input'), {target: {value: '0'}});
        fireEvent.click(screen.getByRole('button', {name: '保存'}));

        expect(screen.getByTestId('node-config-error').textContent).toContain('ready_timeout_ms');
        const node = useGraphStore.getState().graph.nodes.find((item) => item.node_id === 'n_init');
        expect(node?.config).toEqual({sync_group: 'g0', sync_round: 0});
    });

    it('shows english field descriptions when app language is english', async () => {
        await i18n.changeLanguage('en-US');

        server.use(
            http.get('*/api/v1/node-types', () =>
                HttpResponse.json({
                    count: 1,
                    items: [
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
                            config_schema: {
                                type: 'object',
                                properties: {
                                    base_url: {
                                        type: 'string',
                                        title: 'Base URL',
                                        description: 'Base URL of the LLM service.',
                                        default: 'https://api.openai.com',
                                    },
                                    model: {
                                        type: 'string',
                                        title: 'Model',
                                        description: 'Target model name.',
                                        default: 'gpt-4o-mini',
                                    },
                                },
                            },
                            description: 'Real LLM node compatible with the OpenAI Chat Completions API.',
                        },
                    ],
                }),
            ),
        );

        useGraphStore.getState().upsertNode({
            node_id: 'n_en',
            type_name: 'llm.openai_compatible',
            title: 'OpenAI LLM',
            config: {},
        });
        useGraphStore.getState().selectNode('n_en');

        render(<NodeConfigPanel/>);

        expect(await screen.findByLabelText(/Base URL/)).toBeTruthy();
        expect(screen.getByText('Base URL of the LLM service.')).toBeTruthy();
        expect(screen.getByText('Target model name.')).toBeTruthy();
    });
});
