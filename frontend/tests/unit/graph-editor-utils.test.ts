import {describe, expect, it} from 'vitest';

import {
    SOURCE_HANDLE_PREFIX,
    TARGET_HANDLE_PREFIX,
    applyGraphClipboardSnapshot,
    buildSimpleAutoLayout,
    buildGraphClipboardSnapshot,
    buildEdgeId,
    canBindTargetPort,
    deriveValidationTargets,
    edgeToSpec,
    extractPortFromHandle,
    getSchemaColor,
    isSchemaCompatible,
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
        expect(simplifyFrameSchema('any')).toBe('any');
        expect(getSchemaColor('text.final')).toBe('#3b82f6');
        expect(getSchemaColor('audio.full')).toBe('#16a34a');
    });

    it('supports backend-compatible schema matching rules', () => {
        expect(isSchemaCompatible('text.final', 'text.final')).toBe(true);
        expect(isSchemaCompatible('any', 'audio.full')).toBe(true);
        expect(isSchemaCompatible('text.final', 'any')).toBe(true);
        expect(isSchemaCompatible('text.final', 'audio.full')).toBe(false);
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
