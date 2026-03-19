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

    it('updates selected node title and config immediately', () => {
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

        expect(screen.getByTestId('node-config-error').textContent).toContain('配置 JSON 格式无效');
        const node = useGraphStore
            .getState()
            .graph.nodes.find((item) => item.node_id === 'n2');
        expect(node?.config).toEqual({enabled: true});
    });

    it('keeps sync fields readonly for executor and hot-updates runtime config', async () => {
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
        expect(syncGroupInput.tagName).toBe('DIV');
        expect(syncGroupInput.textContent).toBe('group_from_initiator');
        expect(screen.getByTestId('node-config-sync-round-input').textContent).toBe('6');
        expect(screen.getByTestId('node-config-ready-timeout-input').textContent).toBe('1600');
        expect(screen.getByTestId('node-config-commit-lead-input').textContent).toBe('120');

        fireEvent.change(screen.getByTestId('node-config-json-input'), {
            target: {value: '{\n  "volume": 0.8,\n  "channel": "L"\n}'},
        });

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

    it('renders schema readonly fields as plain text instead of inputs', async () => {
        server.use(
            http.get('*/api/v1/node-types', () =>
                HttpResponse.json({
                    count: 1,
                    items: [
                        {
                            type_name: 'mock.readonly',
                            version: '0.1.0',
                            mode: 'async',
                            inputs: [],
                            outputs: [],
                            config_schema: {
                                type: 'object',
                                properties: {
                                    build_id: {
                                        type: 'string',
                                        title: 'Build ID',
                                        readOnly: true,
                                        default: 'build-001',
                                    },
                                    retries: {
                                        type: 'integer',
                                        title: 'Retries',
                                        default: 3,
                                    },
                                },
                            },
                            description: '',
                        },
                    ],
                }),
            ),
        );

        useGraphStore.getState().upsertNode({
            node_id: 'n_readonly',
            type_name: 'mock.readonly',
            title: 'Readonly Node',
            config: {
                build_id: 'build-888',
                retries: 7,
            },
        });
        useGraphStore.getState().selectNode('n_readonly');

        render(<NodeConfigPanel/>);

        await screen.findByText('Build ID');
        expect(screen.getByText('build-888')).toBeTruthy();
        expect(screen.queryByDisplayValue('build-888')).toBeNull();
        expect(screen.getByDisplayValue('7')).toBeTruthy();
    });

    it('renders readonly secret-backed fields as plain text instead of secret controls', async () => {
        server.use(
            http.get('*/api/v1/node-types', () =>
                HttpResponse.json({
                    count: 1,
                    items: [
                        {
                            type_name: 'mock.readonly.secret',
                            version: '0.1.0',
                            mode: 'async',
                            inputs: [],
                            outputs: [],
                            config_schema: {
                                type: 'object',
                                properties: {
                                    api_key: {
                                        title: 'API Key',
                                        description: 'Bind a secret',
                                        anyOf: [{type: 'string'}, {type: 'null'}],
                                        default: null,
                                        readOnly: true,
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
                    count: 1,
                    items: [
                        {
                            secret_id: 'llm-readonly',
                            label: 'Readonly Secret',
                            kind: 'generic',
                            description: '',
                            provider: 'memory',
                            created_at: 1_700_000_100,
                            updated_at: 1_700_000_100,
                            usage_count: 0,
                            in_use: false,
                        },
                    ],
                }),
            ),
        );

        useGraphStore.getState().upsertNode({
            node_id: 'n_readonly_secret',
            type_name: 'mock.readonly.secret',
            title: 'Readonly Secret Node',
            config: {
                api_key: {
                    $kind: 'secret_ref',
                    secret_id: 'llm-readonly',
                },
            },
        });
        useGraphStore.getState().selectNode('n_readonly_secret');

        render(<NodeConfigPanel/>);

        const secretHeading = await screen.findByText('API 密钥');
        const secretSection = secretHeading.closest('[data-field-path="api_key"]');
        expect(secretSection).toBeTruthy();
        expect(within(secretSection as HTMLElement).getByText(/\$kind/)).toBeTruthy();
        expect(within(secretSection as HTMLElement).getByText(/llm-readonly/)).toBeTruthy();
        expect(within(secretSection as HTMLElement).queryByRole('combobox')).toBeNull();
        expect(within(secretSection as HTMLElement).queryByRole('button', {name: '新建密钥'})).toBeNull();
    });

    it('renders schema form and hot-updates inline-created secret refs', async () => {
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

    it('rejects plaintext secret values from advanced json hot update', async () => {
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

    it('shows schema defaults in advanced json when raw config is empty', async () => {
        server.use(
            http.get('*/api/v1/node-types', () =>
                HttpResponse.json({
                    count: 1,
                    items: [
                        {
                            type_name: 'llm.openai_compatible',
                            version: '0.1.0',
                            mode: 'async',
                            inputs: [],
                            outputs: [],
                            config_schema: {
                                type: 'object',
                                properties: {
                                    base_url: {
                                        type: 'string',
                                        title: 'Base URL',
                                        default: 'https://api.openai.com',
                                    },
                                    model: {
                                        type: 'string',
                                        title: 'Model',
                                        default: 'gpt-4o-mini',
                                    },
                                },
                            },
                            description: '',
                        },
                    ],
                }),
            ),
        );

        useGraphStore.getState().upsertNode({
            node_id: 'n_defaults',
            type_name: 'llm.openai_compatible',
            title: 'OpenAI LLM',
            config: {},
        });
        useGraphStore.getState().selectNode('n_defaults');

        render(<NodeConfigPanel/>);

        await screen.findByDisplayValue('https://api.openai.com');
        const jsonInput = screen.getByTestId('node-config-json-input') as HTMLTextAreaElement;
        expect(jsonInput.value).toContain('"base_url": "https://api.openai.com"');
        expect(jsonInput.value).toContain('"model": "gpt-4o-mini"');
    });

    it('keeps inline data-ref item creation and binds a new constant without save', async () => {
        server.use(
            http.get('*/api/v1/node-types', () =>
                HttpResponse.json({
                    count: 1,
                    items: [
                        {
                            type_name: 'data.ref',
                            version: '0.1.0',
                            mode: 'passive',
                            inputs: [],
                            outputs: [{name: 'value', frame_schema: 'any', is_stream: false, required: true, description: ''}],
                            sync_config: null,
                            config_schema: {},
                            description: '',
                            tags: ['data_ref'],
                        },
                    ],
                }),
            ),
        );

        useGraphStore.getState().upsertNode({
            node_id: 'v1',
            type_name: 'data.ref',
            title: 'Variable',
            config: {
                variable_name: '',
            },
        });
        useGraphStore.getState().selectNode('v1');

        render(<NodeConfigPanel/>);

        const panel = await screen.findByTestId('node-config-data-ref');
        fireEvent.click(within(panel).getByRole('button', {name: '新建变量/常量'}));
        fireEvent.change(screen.getByTestId('node-config-variable-name-input'), {
            target: {value: 'api_key'},
        });
        fireEvent.change(screen.getByTestId('node-config-variable-kind-select'), {
            target: {value: 'constant'},
        });
        fireEvent.change(screen.getByRole('combobox', {name: '变量类型'}), {
            target: {value: 'scalar.string'},
        });
        fireEvent.change(screen.getByRole('textbox', {name: '初始值'}), {
            target: {value: 'token-1'},
        });
        fireEvent.click(screen.getByRole('button', {name: '创建并绑定'}));

        const state = useGraphStore.getState();
        expect(state.graph.metadata.data_registry?.variables).toEqual([
            {
                name: 'api_key',
                value_kind: 'scalar.string',
                initial_value: 'token-1',
                is_constant: true,
            },
        ]);
        expect(state.graph.nodes[0]?.config.variable_name).toBe('api_key');
    });

    it('renders custom data writer controls and hot-updates specialized config', async () => {
        server.use(
            http.get('*/api/v1/node-types', () =>
                HttpResponse.json({
                    count: 2,
                    items: [
                        {
                            type_name: 'data.ref',
                            version: '0.1.0',
                            mode: 'passive',
                            inputs: [],
                            outputs: [{name: 'value', frame_schema: 'any', is_stream: false, required: true, description: ''}],
                            sync_config: null,
                            config_schema: {},
                            description: '',
                            tags: ['data_ref'],
                        },
                        {
                            type_name: 'data.writer',
                            version: '0.1.0',
                            mode: 'async',
                            inputs: [{name: 'in', frame_schema: 'any', is_stream: false, required: true, description: ''}],
                            outputs: [],
                            sync_config: null,
                            config_schema: {},
                            description: '',
                            tags: ['data_writer'],
                        },
                    ],
                }),
            ),
        );

        useGraphStore.getState().setMetadata({
            data_registry: {
                variables: [
                    {
                        name: 'counter',
                        value_kind: 'scalar.int',
                        initial_value: 1,
                    },
                    {
                        name: 'step',
                        value_kind: 'scalar.int',
                        initial_value: 2,
                        is_constant: true,
                    },
                ],
            },
        });
        useGraphStore.getState().upsertNode({
            node_id: 'v1',
            type_name: 'data.ref',
            title: 'Variable',
            config: {
                variable_name: 'counter',
            },
        });
        useGraphStore.getState().upsertNode({
            node_id: 'w1',
            type_name: 'data.writer',
            title: 'Writer',
            config: {
                target_variable_name: 'counter',
                operation: 'add',
                operand_mode: 'literal',
                literal_value: 2,
            },
        });
        useGraphStore.getState().selectNode('w1');

        render(<NodeConfigPanel/>);

        const panel = await screen.findByTestId('node-config-data-writer');
        const [targetSelect, operationSelect] = within(panel).getAllByRole('combobox');
        expect(within(targetSelect).queryByRole('option', {name: /step/})).toBeNull();
        fireEvent.change(operationSelect, {
            target: {value: 'multiply'},
        });
        fireEvent.change(within(panel).getByDisplayValue('2'), {
            target: {value: '4'},
        });

        fireEvent.change(within(panel).getAllByRole('combobox')[2], {
            target: {value: 'variable'},
        });
        const operandSelect = within(panel).getByRole('combobox', {name: '操作数变量'});
        expect(within(operandSelect).getByRole('option', {name: /step/})).toBeTruthy();

        const node = useGraphStore.getState().graph.nodes.find((item) => item.node_id === 'w1');
        expect(node?.config.target_variable_name).toBe('counter');
        expect(node?.config.operation).toBe('multiply');
        expect(node?.config.literal_value).toBe(4);
    });
});
