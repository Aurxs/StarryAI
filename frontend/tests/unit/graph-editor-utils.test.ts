import {describe, expect, it} from 'vitest';

import {
    SOURCE_HANDLE_PREFIX,
    TARGET_HANDLE_PREFIX,
    applyGraphClipboardSnapshot,
    buildSimpleAutoLayout,
    buildElkAutoLayout,
    buildGraphClipboardSnapshot,
    buildEdgeId,
    canBindTargetPort,
    deriveValidationTargets,
    edgeToSpec,
    extractPortFromHandle,
    getSchemaColor,
    isSchemaCompatible,
    resolveGraphPortSchemas,
    readNodePositionsFromMetadata,
    simplifyFrameSchema,
    writeNodePositionsToMetadata,
} from '../../src/features/graph-editor/utils';

describe('graph-editor utils', () => {
    it('builds stable edge id from node and port identifiers', () => {
        expect(buildEdgeId('n1', 'text', 'n2', 'in')).toBe('n1.text->n2.in');
    });

    it('extracts source/target ports from handle ids', () => {
        expect(extractPortFromHandle(`${SOURCE_HANDLE_PREFIX}answer`, SOURCE_HANDLE_PREFIX)).toBe(
            'answer',
        );
        expect(extractPortFromHandle(`${TARGET_HANDLE_PREFIX}prompt`, TARGET_HANDLE_PREFIX)).toBe(
            'prompt',
        );
    });

    it('returns null for invalid handle ids (edge path)', () => {
        expect(extractPortFromHandle('wrong:port', SOURCE_HANDLE_PREFIX)).toBeNull();
        expect(extractPortFromHandle('', TARGET_HANDLE_PREFIX)).toBeNull();
        expect(extractPortFromHandle(undefined, TARGET_HANDLE_PREFIX)).toBeNull();
    });

    it('blocks duplicate target handle binding', () => {
        const canBind = canBindTargetPort(
            [
                {
                    target: 'n2',
                    targetHandle: 'in:in',
                },
            ],
            'n2',
            'in:in',
        );
        expect(canBind).toBe(false);
    });

    it('converts react-flow edges to backend EdgeSpec', () => {
        const spec = edgeToSpec({
            source: 'n1',
            sourceHandle: 'out:text',
            target: 'n2',
            targetHandle: 'in:prompt',
        });

        expect(spec).toEqual({
            source_node: 'n1',
            source_port: 'text',
            target_node: 'n2',
            target_port: 'prompt',
            queue_maxsize: 0,
        });
    });

    it('returns null when edge handles are incomplete (edge path)', () => {
        const spec = edgeToSpec({
            source: 'n1',
            sourceHandle: null,
            target: 'n2',
            targetHandle: 'in:prompt',
        });
        expect(spec).toBeNull();
    });

    it('derives node/edge highlights from validation issues', () => {
        const targets = deriveValidationTargets(
            {
                graph_id: 'g1',
                version: '0.1.0',
                nodes: [
                    {node_id: 'n1', type_name: 'mock.input', title: 'n1', config: {}},
                    {node_id: 'n2', type_name: 'mock.output', title: 'n2', config: {}},
                ],
                edges: [
                    {
                        source_node: 'n1',
                        source_port: 'text',
                        target_node: 'n2',
                        target_port: 'in',
                        queue_maxsize: 0,
                    },
                ],
                metadata: {},
            },
            [
                {
                    level: 'error',
                    code: 'edge.schema_mismatch',
                    message: '边 schema 不兼容: n1.text(text.final) -> n2.in',
                },
            ],
        );

        expect(targets.nodeIds.has('n1')).toBe(true);
        expect(targets.nodeIds.has('n2')).toBe(true);
        expect(targets.edgeIds.has('n1.text->n2.in')).toBe(true);
    });

    it('simplifies schema labels and maps colors', () => {
        expect(simplifyFrameSchema('text.final')).toBe('text');
        expect(simplifyFrameSchema('audio.full')).toBe('audio');
        expect(simplifyFrameSchema('audio.full.sync')).toBe('audio.sync');
        expect(simplifyFrameSchema('any')).toBe('any');
        expect(getSchemaColor('text.final')).toBe('#3b82f6');
        expect(getSchemaColor('audio.full')).toBe('#16a34a');
        expect(getSchemaColor('audio.full.sync')).toBe('#16a34a');
    });

    it('supports backend-compatible schema matching rules', () => {
        expect(isSchemaCompatible('text.final', 'text.final')).toBe(true);
        expect(isSchemaCompatible('any', 'audio.full')).toBe(true);
        expect(isSchemaCompatible('text.final', 'any')).toBe(true);
        expect(isSchemaCompatible('text.final', 'audio.full')).toBe(false);
        expect(isSchemaCompatible('audio.full.sync', 'audio.full.sync')).toBe(true);
        expect(isSchemaCompatible('any.sync', 'motion.timeline.sync')).toBe(true);
        expect(isSchemaCompatible('audio.full', 'audio.full.sync')).toBe(false);
        expect(isSchemaCompatible('none', 'any')).toBe(false);
    });

    it('builds auto-layout positions for disconnected graphs (edge path)', () => {
        const positions = buildSimpleAutoLayout({
            graph_id: 'g',
            version: '0.1.0',
            nodes: [
                {node_id: 'n1', type_name: 'mock.input', title: 'n1', config: {}},
                {node_id: 'n2', type_name: 'mock.output', title: 'n2', config: {}},
                {node_id: 'n3', type_name: 'mock.output', title: 'n3', config: {}},
            ],
            edges: [],
            metadata: {},
        });
        expect(positions.n1).toBeTruthy();
        expect(positions.n2).toBeTruthy();
        expect(positions.n3).toBeTruthy();
    });

    it('uses ELK auto-layout to preserve initiator output ordering (edge path)', async () => {
        const positions = await buildElkAutoLayout({
            graph_id: 'g_elk_sync',
            version: '0.1.0',
            nodes: [
                {node_id: 'n1', type_name: 'mock.motion', title: 'motion-src', config: {}},
                {node_id: 'n2', type_name: 'mock.tts', title: 'audio-src', config: {}},
                {node_id: 'n3', type_name: 'sync.initiator.dual', title: 'initiator', config: {}},
                {node_id: 'n4', type_name: 'audio.play.sync', title: 'audio-exec', config: {}},
                {node_id: 'n5', type_name: 'motion.play.sync', title: 'motion-exec', config: {}},
            ],
            edges: [
                {
                    source_node: 'n1',
                    source_port: 'motion',
                    target_node: 'n3',
                    target_port: 'in_b',
                    queue_maxsize: 0,
                },
                {
                    source_node: 'n2',
                    source_port: 'audio',
                    target_node: 'n3',
                    target_port: 'in_a',
                    queue_maxsize: 0,
                },
                {
                    source_node: 'n3',
                    source_port: 'out_a',
                    target_node: 'n4',
                    target_port: 'in',
                    queue_maxsize: 0,
                },
                {
                    source_node: 'n3',
                    source_port: 'out_b',
                    target_node: 'n5',
                    target_port: 'in',
                    queue_maxsize: 0,
                },
            ],
            metadata: {},
        });

        expect(positions.n4).toBeTruthy();
        expect(positions.n5).toBeTruthy();
        expect(positions.n2.y).toBeLessThanOrEqual(positions.n1.y);
        expect(positions.n4.y).toBeLessThanOrEqual(positions.n5.y);
    });

    it('reorders same-layer upstream nodes by initiator input port order (edge path)', async () => {
        const positions = await buildElkAutoLayout({
            graph_id: 'g_elk_port_order',
            version: '0.1.0',
            nodes: [
                {node_id: 'n1', type_name: 'mock.llm', title: 'llm', config: {}},
                {node_id: 'n2', type_name: 'mock.motion', title: 'motion', config: {}},
                {node_id: 'n3', type_name: 'mock.tts', title: 'tts', config: {}},
                {node_id: 'n4', type_name: 'sync.initiator.dual', title: 'initiator', config: {}},
            ],
            edges: [
                {
                    source_node: 'n1',
                    source_port: 'out',
                    target_node: 'n2',
                    target_port: 'intext',
                    queue_maxsize: 0,
                },
                {
                    source_node: 'n1',
                    source_port: 'out',
                    target_node: 'n3',
                    target_port: 'intext',
                    queue_maxsize: 0,
                },
                {
                    source_node: 'n3',
                    source_port: 'audio',
                    target_node: 'n4',
                    target_port: 'in_a',
                    queue_maxsize: 0,
                },
                {
                    source_node: 'n2',
                    source_port: 'motion',
                    target_node: 'n4',
                    target_port: 'in_b',
                    queue_maxsize: 0,
                },
            ],
            metadata: {},
        });

        expect(positions.n2).toBeTruthy();
        expect(positions.n3).toBeTruthy();
        expect(positions.n3.y).toBeLessThanOrEqual(positions.n2.y);
    });

    it('resolves dynamic initiator output schema from upstream connection', () => {
        const graph = {
            graph_id: 'g_sync',
            version: '0.1.0',
            nodes: [
                {node_id: 'n1', type_name: 'mock.tts', title: 'tts', config: {}},
                {node_id: 'n2', type_name: 'sync.initiator.dual', title: 'initiator', config: {}},
                {node_id: 'n3', type_name: 'audio.play.sync', title: 'audio', config: {}},
            ],
            edges: [
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
            ],
            metadata: {},
        };
        const catalogByType = new Map([
            [
                'mock.tts',
                {
                    type_name: 'mock.tts',
                    version: '0.1.0',
                    mode: 'async',
                    inputs: [{name: 'text', frame_schema: 'text.final', is_stream: false, required: true, description: ''}],
                    outputs: [{name: 'audio', frame_schema: 'audio.full', is_stream: false, required: true, description: ''}],
                    sync_config: null,
                    config_schema: {},
                    description: '',
                },
            ],
            [
                'sync.initiator.dual',
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
            [
                'audio.play.sync',
                {
                    type_name: 'audio.play.sync',
                    version: '0.1.0',
                    mode: 'sync',
                    inputs: [{name: 'in', frame_schema: 'audio.full.sync', is_stream: false, required: true, description: ''}],
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
        ]);

        const resolved = resolveGraphPortSchemas(graph, catalogByType);
        expect(resolved.inputs.n2?.in_a).toBe('audio.full');
        expect(resolved.outputs.n2?.out_a).toBe('audio.full.sync');
        expect(resolved.outputs.n2?.out_b).toBe('any.sync');
        expect(resolved.inputs.n3?.in).toBe('audio.full.sync');
    });

    it('resolves passive data container schema and requester passthrough output schema', () => {
        const graph = {
            graph_id: 'g_data_request',
            version: '0.1.0',
            nodes: [
                {
                    node_id: 'v1',
                    type_name: 'data.variable',
                    title: 'var',
                    config: {value_type: 'float', initial_value: 1.5},
                },
                {
                    node_id: 'r1',
                    type_name: 'data.requester',
                    title: 'request',
                    config: {},
                },
            ],
            edges: [
                {
                    source_node: 'v1',
                    source_port: 'value',
                    target_node: 'r1',
                    target_port: 'source',
                    queue_maxsize: 0,
                },
            ],
            metadata: {},
        };
        const catalogByType = new Map([
            [
                'data.variable',
                {
                    type_name: 'data.variable',
                    version: '0.1.0',
                    mode: 'passive',
                    inputs: [],
                    outputs: [{name: 'value', frame_schema: 'any', is_stream: false, required: true, description: ''}],
                    sync_config: null,
                    config_schema: {},
                    description: '',
                    tags: ['data_container'],
                },
            ],
            [
                'data.requester',
                {
                    type_name: 'data.requester',
                    version: '0.1.0',
                    mode: 'async',
                    inputs: [
                        {name: 'source', frame_schema: 'any', is_stream: false, required: true, description: '', input_behavior: 'reference'},
                        {name: 'trigger', frame_schema: 'any', is_stream: false, required: true, description: '', input_behavior: 'trigger'},
                    ],
                    outputs: [
                        {
                            name: 'value',
                            frame_schema: 'any',
                            is_stream: false,
                            required: true,
                            description: '',
                            derived_from_input: 'source',
                        },
                    ],
                    sync_config: null,
                    config_schema: {},
                    description: '',
                    tags: ['data_requester'],
                },
            ],
        ]);

        const resolved = resolveGraphPortSchemas(graph, catalogByType);
        expect(resolved.outputs.v1?.value).toBe('scalar.float');
        expect(resolved.inputs.r1?.source).toBe('scalar.float');
        expect(resolved.outputs.r1?.value).toBe('scalar.float');
        expect(simplifyFrameSchema('scalar.float')).toBe('float');
        expect(getSchemaColor('json.dict')).toBe('#c2410c');
    });

    it('builds and applies clipboard snapshot for multi-node copy with preserved edge/relative positions', () => {
        const graph = {
            graph_id: 'g',
            version: '0.1.0',
            nodes: [
                {node_id: 'n1', type_name: 'mock.input', title: 'n1', config: {v: 1}},
                {node_id: 'n2', type_name: 'mock.output', title: 'n2', config: {v: 2}},
                {node_id: 'n3', type_name: 'mock.output', title: 'n3', config: {v: 3}},
            ],
            edges: [
                {
                    source_node: 'n1',
                    source_port: 'text',
                    target_node: 'n2',
                    target_port: 'in',
                    queue_maxsize: 0,
                },
                {
                    source_node: 'n1',
                    source_port: 'text',
                    target_node: 'n3',
                    target_port: 'in',
                    queue_maxsize: 0,
                },
            ],
            metadata: {},
        };
        const positions = {
            n1: {x: 100, y: 120},
            n2: {x: 300, y: 180},
            n3: {x: 420, y: 360},
        };

        const snapshot = buildGraphClipboardSnapshot(graph, ['n1', 'n2'], positions);
        expect(snapshot).toBeTruthy();
        if (!snapshot) {
            return;
        }
        expect(snapshot.nodes.map((node) => node.node_id)).toEqual(['n1', 'n2']);
        expect(snapshot.edges).toHaveLength(1);
        expect(snapshot.edges[0]?.target_node).toBe('n2');

        const pasted = applyGraphClipboardSnapshot(graph, positions, snapshot, {
            offset: {x: 48, y: 48},
            pasteCount: 1,
        });
        expect(pasted).toBeTruthy();
        if (!pasted) {
            return;
        }
        expect(pasted.nodes).toHaveLength(5);
        expect(pasted.edges).toHaveLength(3);
        expect(pasted.createdNodeIds).toHaveLength(2);

        const firstPastedId = pasted.createdNodeIds[0];
        const secondPastedId = pasted.createdNodeIds[1];
        expect(firstPastedId).not.toBe('n1');
        expect(secondPastedId).not.toBe('n2');

        const firstPos = pasted.positions[firstPastedId];
        const secondPos = pasted.positions[secondPastedId];
        expect(firstPos).toEqual({x: 148, y: 168});
        expect(secondPos).toEqual({x: 348, y: 228});
        expect(secondPos.x - firstPos.x).toBe(200);
        expect(secondPos.y - firstPos.y).toBe(60);

        const clonedEdge = pasted.edges.find(
            (edge) => edge.source_node === firstPastedId && edge.target_node === secondPastedId,
        );
        expect(clonedEdge).toBeTruthy();
        expect(clonedEdge?.source_port).toBe('text');
        expect(clonedEdge?.target_port).toBe('in');
    });

    it('reads valid node positions from metadata and ignores malformed entries', () => {
        const positions = readNodePositionsFromMetadata(
            {
                ui_layout: {
                    node_positions: {
                        n1: {x: 100, y: 200},
                        n2: {x: 50, y: 'bad'},
                        n3: 'bad',
                    },
                },
            },
            new Set(['n1', 'n2']),
        );

        expect(positions).toEqual({
            n1: {x: 100, y: 200},
        });
    });

    it('writes node positions into metadata and preserves unrelated metadata keys', () => {
        const metadata = writeNodePositionsToMetadata(
            {
                owner: 'tester',
                ui_layout: {
                    viewport: {x: 1, y: 2, zoom: 0.7},
                },
            },
            {
                n1: {x: 88, y: 144},
                n2: {x: Number.NaN, y: 12},
            },
            ['n1', 'n3'],
        );

        expect(metadata).toEqual({
            owner: 'tester',
            ui_layout: {
                viewport: {x: 1, y: 2, zoom: 0.7},
                node_positions: {
                    n1: {x: 88, y: 144},
                },
            },
        });
    });
});
