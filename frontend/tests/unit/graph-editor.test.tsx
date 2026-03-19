import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {http, HttpResponse} from 'msw';
import {beforeEach, describe, expect, it} from 'vitest';

import {GraphEditor} from '../../src/features/graph-editor/GraphEditor';
import {resetGraphStore, useGraphStore} from '../../src/shared/state/graph-store';
import {resetGlobalInfoStore, useGlobalInfoStore} from '../../src/shared/state/global-info-store';
import {resetUiStore, useUiStore} from '../../src/shared/state/ui-store';
import {server} from '../mocks/server';

const addNodeFromDrawer = (typeName: string) => {
    fireEvent.click(screen.getByTitle('新增节点'));
    const drawer = screen.getByLabelText('node-library-drawer');
    fireEvent.click(within(drawer).getByText(typeName));
};

const openVariableManager = () => {
    fireEvent.click(screen.getByTestId('graph-editor-open-variable-manager'));
    return screen.getByLabelText('variable-manager-drawer');
};

describe('GraphEditor', () => {
    beforeEach(() => {
        resetGraphStore();
        resetUiStore();
        resetGlobalInfoStore();
    });

    it('adds nodes into graph store via drawer add buttons', async () => {
        render(<GraphEditor/>);

        addNodeFromDrawer('mock.input');
        addNodeFromDrawer('mock.output');

        const graph = useGraphStore.getState().graph;
        expect(graph.nodes).toHaveLength(2);
    });

    it('falls back to built-in catalog when node-types API fails (edge path)', async () => {
        server.use(
            http.get('*/api/v1/node-types', () =>
                HttpResponse.json(
                    {detail: 'temporary error'},
                    {
                        status: 503,
                    },
                ),
            ),
        );

        render(<GraphEditor/>);

        addNodeFromDrawer('mock.input');
        expect(useGraphStore.getState().graph.nodes).toHaveLength(1);
    });

    it('initializes default sync config when adding sync initiator node', async () => {
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
                                {name: 'in_a', frame_schema: 'any', is_stream: false, required: true, description: ''},
                                {name: 'in_b', frame_schema: 'any', is_stream: false, required: true, description: ''},
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

        render(<GraphEditor/>);
        fireEvent.click(screen.getByTitle('新增节点'));
        const drawer = screen.getByLabelText('node-library-drawer');
        fireEvent.click(await within(drawer).findByText('sync.initiator.dual'));

        const node = useGraphStore.getState().graph.nodes.find((item) => item.type_name === 'sync.initiator.dual');
        expect(node).toBeTruthy();
        expect(String(node?.config.sync_group)).toMatch(/^sg-/);
        expect(node?.config.sync_round).toBe(0);
        expect(node?.config.ready_timeout_ms).toBe(800);
        expect(node?.config.commit_lead_ms).toBe(50);
        expect(node?.config.__sync_round_auto).toBe(true);
    });

    it('deletes node through node context menu', async () => {
        render(<GraphEditor/>);

        addNodeFromDrawer('mock.input');
        addNodeFromDrawer('mock.output');
        expect(useGraphStore.getState().graph.nodes).toHaveLength(2);

        const nodeCard = await screen.findByTestId('workflow-node-n1');
        fireEvent.contextMenu(nodeCard);
        expect(useGraphStore.getState().selectedNodeId).toBeNull();
        fireEvent.click(screen.getByRole('button', {name: '删除 Del'}));
        expect(useGraphStore.getState().graph.nodes).toHaveLength(1);
        expect(useGraphStore.getState().graph.nodes[0]?.node_id).toBe('n2');
    });

    it('renders context menu with about section and shortcuts', async () => {
        render(<GraphEditor/>);

        addNodeFromDrawer('mock.input');

        const nodeCard = await screen.findByTestId('workflow-node-n1');
        fireEvent.contextMenu(nodeCard);

        const menu = screen.getByRole('menu', {name: 'node-context-menu'});
        expect(within(menu).getByText('拷贝')).toBeTruthy();
        expect(within(menu).getByText('复制')).toBeTruthy();
        expect(within(menu).getByText('删除')).toBeTruthy();
        expect(within(menu).getByText(/(⌘|Ctrl)\sC/)).toBeTruthy();
        expect(within(menu).getByText(/(⌘|Ctrl)\sD/)).toBeTruthy();
        expect(within(menu).getByText('Del')).toBeTruthy();
        expect(within(menu).getByText('关于')).toBeTruthy();
        expect(within(menu).getByText('mock.input')).toBeTruthy();
        expect(within(menu).getByText('暂无节点说明。')).toBeTruthy();
    });

    it('keeps port descriptions off workflow nodes while still localizing node descriptions', async () => {
        server.use(
            http.get('*/api/v1/node-types', () =>
                HttpResponse.json({
                    count: 1,
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
                                    description: 'Complete text output.',
                                },
                            ],
                            sync_config: null,
                            config_schema: {},
                            description: 'Mock input node that emits complete text payloads.',
                        },
                    ],
                }),
            ),
        );

        render(<GraphEditor/>);

        addNodeFromDrawer('mock.input');

        const nodeCard = await screen.findByTestId('workflow-node-n1');
        await waitFor(() => {
            const portTag = within(screen.getByTestId('workflow-node-n1')).getByTestId('port-tag-out-text');
            expect(portTag.getAttribute('title')).toBeNull();
            expect(portTag.textContent).toContain('text');
            expect(within(portTag).queryByText('完整文本输出。')).toBeNull();
            expect(within(portTag).queryByText('out:text')).toBeNull();
        });

        fireEvent.contextMenu(nodeCard);
        const menu = screen.getByRole('menu', {name: 'node-context-menu'});
        await waitFor(() => {
            expect(within(menu).getByText('模拟输入节点，产出完整文本。')).toBeTruthy();
        });
    });

    it('renders a single-line node title and anchors port handles beside each port row', async () => {
        server.use(
            http.get('*/api/v1/node-types', () =>
                HttpResponse.json({
                    count: 1,
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
                                    description: 'Complete text output.',
                                },
                            ],
                            sync_config: null,
                            config_schema: {},
                            description: 'Mock input node that emits complete text payloads.',
                        },
                    ],
                }),
            ),
        );

        render(<GraphEditor/>);

        addNodeFromDrawer('mock.input');
        useGraphStore.getState().patchNode('n1', {title: 'Input A', config: {}});

        await screen.findByTestId('workflow-node-n1');
        await waitFor(() => {
            const nodeCard = screen.getByTestId('workflow-node-n1');
            expect(within(nodeCard).getByText('Input A')).toBeTruthy();
            expect(within(nodeCard).queryByText('mock.input')).toBeNull();

            const outputPortRow = within(nodeCard).getByTestId('port-tag-out-text');
            expect(outputPortRow.textContent).toContain('text');
            expect(within(outputPortRow).queryByText('完整文本输出。')).toBeNull();
            expect(within(outputPortRow).queryByText('out:text')).toBeNull();
            expect(outputPortRow.querySelector('.react-flow__handle-right')).toBeTruthy();
        });
    });

    it('renders the bound variable subtitle for passive data nodes', async () => {
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
                            outputs: [
                                {
                                    name: 'value',
                                    frame_schema: 'int',
                                    is_stream: false,
                                    required: true,
                                    description: '',
                                },
                            ],
                            sync_config: null,
                            config_schema: {},
                            description: 'Passive data reference node.',
                            tags: ['data_ref'],
                        },
                    ],
                }),
            ),
        );

        render(<GraphEditor/>);
        useGraphStore.getState().setMetadata({
            data_registry: {
                variables: [
                    {
                        name: 'counter',
                        value_kind: 'scalar.int',
                        initial_value: 0,
                    },
                ],
            },
        });

        fireEvent.click(screen.getByTitle('新增节点'));
        const drawer = screen.getByLabelText('node-library-drawer');
        fireEvent.click(await within(drawer).findByText('data.ref'));
        useGraphStore.getState().patchNode('n1', {
            title: 'Data Ref',
            config: {variable_name: 'counter'},
        });

        const nodeCard = await screen.findByTestId('workflow-node-n1');
        await waitFor(() => {
            expect(within(nodeCard).getByTestId('workflow-node-subtitle').textContent).toBe('counter · 整数');
            expect(within(nodeCard).queryByText('container')).toBeNull();
        });
    });

    it('keeps node library and variable manager drawers mutually exclusive', async () => {
        render(<GraphEditor/>);

        fireEvent.click(screen.getByTitle('新增节点'));
        expect(screen.getByLabelText('node-library-drawer')).toBeTruthy();

        fireEvent.click(screen.getByTestId('graph-editor-open-variable-manager'));
        expect(screen.getByLabelText('variable-manager-drawer')).toBeTruthy();
        expect(screen.queryByLabelText('node-library-drawer')).toBeNull();
    });

    it('updates passive data-node subtitle after variable rename in manager', async () => {
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
                            outputs: [
                                {
                                    name: 'value',
                                    frame_schema: 'int',
                                    is_stream: false,
                                    required: true,
                                    description: '',
                                },
                            ],
                            sync_config: null,
                            config_schema: {},
                            description: 'Passive data reference node.',
                            tags: ['data_ref'],
                        },
                    ],
                }),
            ),
        );

        render(<GraphEditor/>);
        useGraphStore.getState().createVariable({
            name: 'counter',
            value_kind: 'scalar.int',
            initial_value: 0,
        });
        fireEvent.click(screen.getByTitle('新增节点'));
        const nodeLibraryDrawer = screen.getByLabelText('node-library-drawer');
        fireEvent.click(await within(nodeLibraryDrawer).findByText('data.ref'));
        useGraphStore.getState().patchNode('n1', {
            title: 'Data Ref',
            config: {variable_name: 'counter'},
        });

        const nodeCard = await screen.findByTestId('workflow-node-n1');
        await waitFor(() => {
            expect(within(nodeCard).getByTestId('workflow-node-subtitle').textContent).toBe('counter · 整数');
        });

        const drawer = openVariableManager();
        fireEvent.click(within(drawer).getByTestId('variable-manager-item-counter'));
        fireEvent.change(within(drawer).getByTestId('variable-manager-name-input'), {
            target: {value: 'balance'},
        });
        fireEvent.click(within(drawer).getByTestId('variable-manager-save-button'));

        await waitFor(() => {
            expect(within(nodeCard).getByTestId('workflow-node-subtitle').textContent).toBe('balance · 整数');
        });
    });

    it('renders node namespace subtitle for non-data nodes', async () => {
        server.use(
            http.get('*/api/v1/node-types', () =>
                HttpResponse.json({
                    count: 1,
                    items: [
                        {
                            type_name: 'llm.chat',
                            version: '0.1.0',
                            mode: 'async',
                            inputs: [
                                {
                                    name: 'in',
                                    frame_schema: 'text.final',
                                    is_stream: false,
                                    required: true,
                                    description: '',
                                },
                            ],
                            outputs: [
                                {
                                    name: 'out',
                                    frame_schema: 'text.final',
                                    is_stream: false,
                                    required: true,
                                    description: '',
                                },
                            ],
                            sync_config: null,
                            config_schema: {},
                            description: 'Unified chat-style LLM node.',
                        },
                    ],
                }),
            ),
        );

        render(<GraphEditor/>);

        fireEvent.click(screen.getByTitle('新增节点'));
        const drawer = screen.getByLabelText('node-library-drawer');
        fireEvent.click(await within(drawer).findByText('llm.chat'));

        const nodeCard = await screen.findByTestId('workflow-node-n1');
        await waitFor(() => {
            expect(within(nodeCard).getByTestId('workflow-node-subtitle').textContent).toBe('llm');
            expect(within(nodeCard).queryByText('异步节点')).toBeNull();
        });
    });

    it('supports single-node copy/paste shortcuts with full config cloning', async () => {
        render(<GraphEditor/>);

        addNodeFromDrawer('mock.input');
        useGraphStore.getState().patchNode('n1', {
            title: 'Input A',
            config: {
                nested: {temperature: 0.42},
                retry: 2,
            },
        });

        const nodeCard = await screen.findByTestId('workflow-node-n1');
        fireEvent.click(nodeCard);
        fireEvent.keyDown(window, {key: 'c', metaKey: true});
        fireEvent.keyDown(window, {key: 'v', metaKey: true});

        await waitFor(() => {
            expect(useGraphStore.getState().graph.nodes).toHaveLength(2);
        });

        const [original, copied] = useGraphStore.getState().graph.nodes;
        expect(original?.node_id).toBe('n1');
        expect(copied?.node_id).toBe('n2');
        expect(copied?.type_name).toBe(original?.type_name);
        expect(copied?.title).toBe(original?.title);
        expect(copied?.config).toEqual(original?.config);
        expect(copied?.config).not.toBe(original?.config);
    });

    it('opens node config target by single-click in pointer and hand modes', async () => {
        render(<GraphEditor/>);

        addNodeFromDrawer('mock.input');

        const nodeCard = await screen.findByTestId('workflow-node-n1');

        useUiStore.getState().setEditorMode('pointer');
        useGraphStore.getState().selectNode(null);
        fireEvent.click(nodeCard);
        expect(useGraphStore.getState().selectedNodeId).toBe('n1');
        await waitFor(() => {
            expect((screen.getByTestId('workflow-node-n1') as HTMLDivElement).style.boxShadow).toContain('59, 130, 246');
        });

        useUiStore.getState().setEditorMode('hand');
        useGraphStore.getState().selectNode(null);
        fireEvent.click(nodeCard);
        expect(useGraphStore.getState().selectedNodeId).toBe('n1');
    });

    it('applies auto-layout request and surfaces completion message (edge path)', async () => {
        render(<GraphEditor/>);

        addNodeFromDrawer('mock.input');
        addNodeFromDrawer('mock.output');
        const previousFitTick = useUiStore.getState().fitCanvasRequestTick;

        useUiStore.getState().requestAutoLayout();
        await waitFor(() => {
            const messages = useGlobalInfoStore.getState().messages;
            expect(messages.some((item) => item.message === '节点已自动整理')).toBe(true);
        });
        await waitFor(() => {
            expect(useUiStore.getState().fitCanvasRequestTick).toBeGreaterThan(previousFitTick);
        });
    });

    it('renders updated canvas background, locator dots and minimap sizing', async () => {
        render(<GraphEditor/>);

        expect((screen.getByTestId('graph-editor-shell') as HTMLElement).style.background).toBe('rgb(242, 244, 247)');

        const background = screen.getByTestId('rf__background');
        const locatorDot = background.querySelector('circle');
        expect(locatorDot?.getAttribute('fill')).toBe('#c3ccd8');
        expect(locatorDot?.getAttribute('r')).toBe('0.9');

        const minimap = screen.getByTestId('rf__minimap') as HTMLElement;
        expect(minimap.style.width).toBe('132px');
        expect(minimap.style.height).toBe('84px');
        expect(screen.getByTestId('zoom-control-bar')).toBeTruthy();
    });

    it('opens settings dialog and switches language option', async () => {
        render(<GraphEditor/>);

        fireEvent.click(screen.getByRole('button', {name: '设置'}));
        const dialog = screen.getByRole('dialog', {name: '设置'});
        const languageSelect = within(dialog).getByLabelText('语言') as HTMLSelectElement;
        expect(languageSelect.value).toBe('zh-CN');

        fireEvent.change(languageSelect, {target: {value: 'en-US'}});
        await waitFor(() => {
            expect(screen.getByRole('button', {name: 'Settings'})).toBeTruthy();
        });
    });

    it('updates data.ref subtitle value-kind label immediately after language switch', async () => {
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
                            outputs: [
                                {
                                    name: 'value',
                                    frame_schema: 'int',
                                    is_stream: false,
                                    required: true,
                                    description: '',
                                },
                            ],
                            sync_config: null,
                            config_schema: {},
                            description: 'Passive data reference node.',
                            tags: ['data_ref'],
                        },
                    ],
                }),
            ),
        );

        render(<GraphEditor/>);

        useGraphStore.getState().setMetadata({
            data_registry: {
                variables: [
                    {
                        name: 'message',
                        value_kind: 'scalar.string',
                        initial_value: 'hello',
                    },
                ],
            },
        });

        fireEvent.click(screen.getByTitle('新增节点'));
        const drawer = screen.getByLabelText('node-library-drawer');
        fireEvent.click(await within(drawer).findByText('data.ref'));
        useGraphStore.getState().patchNode('n1', {
            title: 'ref-message',
            config: {variable_name: 'message'},
        });

        const nodeCard = await screen.findByTestId('workflow-node-n1');

        await waitFor(() => {
            expect(within(nodeCard).getByTestId('workflow-node-subtitle').textContent).toBe('message · 字符串');
        });

        fireEvent.click(screen.getByRole('button', {name: '设置'}));
        const dialog = screen.getByRole('dialog', {name: '设置'});
        const languageSelect = within(dialog).getByLabelText('语言') as HTMLSelectElement;
        fireEvent.change(languageSelect, {target: {value: 'en-US'}});

        await waitFor(() => {
            expect(within(nodeCard).getByTestId('workflow-node-subtitle').textContent).toBe('message · String');
        });
    });

    it('supports +/-10% zoom controls and clamps ratio to [20%, 200%] (edge path)', async () => {
        render(<GraphEditor/>);

        const zoomRatioButton = screen.getByTestId('zoom-ratio-button');
        const zoomOutButton = screen.getByTitle('缩小 10%');
        const zoomInButton = screen.getByTitle('放大 10%');

        expect(zoomRatioButton.textContent).toContain('70%');
        fireEvent.click(zoomInButton);
        await waitFor(() => {
            expect(screen.getByTestId('zoom-ratio-button').textContent).toContain('80%');
        });

        for (let i = 0; i < 12; i += 1) {
            fireEvent.click(zoomOutButton);
        }
        await waitFor(() => {
            expect(screen.getByTestId('zoom-ratio-button').textContent).toContain('20%');
        });

        for (let i = 0; i < 30; i += 1) {
            fireEvent.click(zoomInButton);
        }
        await waitFor(() => {
            expect(screen.getByTestId('zoom-ratio-button').textContent).toContain('200%');
        });
    });

    it('closes zoom preset menu when clicking outside', async () => {
        render(<GraphEditor/>);

        fireEvent.click(screen.getByTestId('zoom-ratio-button'));
        expect(screen.getByRole('button', {name: '50%'})).toBeTruthy();

        fireEvent.pointerDown(document.body);
        await waitFor(() => {
            expect(screen.queryByRole('button', {name: '50%'})).toBeNull();
        });
    });

    it('keeps edge marker color aligned with source port type', async () => {
        server.use(
            http.get('*/api/v1/node-types', () =>
                HttpResponse.json(
                    {detail: 'temporary error'},
                    {
                        status: 503,
                    },
                ),
            ),
        );

        render(<GraphEditor/>);
        addNodeFromDrawer('mock.input');
        addNodeFromDrawer('mock.output');

        useGraphStore.getState().setEdges([
            {
                source_node: 'n1',
                source_port: 'text',
                target_node: 'n2',
                target_port: 'in',
                queue_maxsize: 0,
            },
        ]);

        await waitFor(() => {
            const markerPolyline = document.querySelector('.react-flow__arrowhead polyline') as SVGPolylineElement | null;
            expect(markerPolyline).toBeTruthy();
            expect(markerPolyline?.getAttribute('style') ?? '').toContain('stroke: #3b82f6');
        });
    });

    it('renders initiator and sync input types with resolved *.sync labels', async () => {
        server.use(
            http.get('*/api/v1/node-types', () =>
                HttpResponse.json({
                    count: 3,
                    items: [
                        {
                            type_name: 'mock.tts',
                            version: '0.1.0',
                            mode: 'async',
                            inputs: [{
                                name: 'text',
                                frame_schema: 'text.final',
                                is_stream: false,
                                required: true,
                                description: '',
                            }],
                            outputs: [{
                                name: 'audio',
                                frame_schema: 'audio.full',
                                is_stream: false,
                                required: true,
                                description: '',
                            }],
                            sync_config: null,
                            config_schema: {},
                            description: '',
                        },
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
                        {
                            type_name: 'audio.play.sync',
                            version: '0.1.0',
                            mode: 'sync',
                            inputs: [{
                                name: 'in',
                                frame_schema: 'audio.full.sync',
                                is_stream: false,
                                required: true,
                                description: '',
                            }],
                            outputs: [],
                            sync_config: {
                                required_ports: ['in'],
                                strategy: 'barrier',
                                window_ms: 40,
                                late_policy: 'drop',
                                role: 'executor',
                            },
                            config_schema: {},
                            description: '',
                        },
                    ],
                }),
            ),
        );

        useGraphStore.getState().setNodes([
            {
                node_id: 'n1',
                type_name: 'mock.tts',
                title: 'tts',
                config: {},
            },
            {
                node_id: 'n2',
                type_name: 'sync.initiator.dual',
                title: 'initiator',
                config: {},
            },
            {
                node_id: 'n3',
                type_name: 'audio.play.sync',
                title: 'audio_sync',
                config: {},
            },
        ]);
        useGraphStore.getState().setEdges([
            {
                source_node: 'n1',
                source_port: 'audio',
                target_node: 'n2',
                target_port: 'in_a',
                queue_maxsize: 0,
            },
            {
                source_node: 'n2',
                source_port: 'out_a',
                target_node: 'n3',
                target_port: 'in',
                queue_maxsize: 0,
            },
        ]);

        render(<GraphEditor/>);

        await screen.findByTestId('workflow-node-n2');
        await screen.findByTestId('workflow-node-n3');
        await waitFor(() => {
            expect(screen.getByTestId('workflow-node-n2').textContent).toContain('audio.sync');
            expect(screen.getByTestId('workflow-node-n2').textContent).toContain('any.sync');
            expect(screen.getByTestId('workflow-node-n3').textContent).toContain('audio.sync');
        });
    });
});
