import {describe, expect, it} from 'vitest';

import {
    SOURCE_HANDLE_PREFIX,
    TARGET_HANDLE_PREFIX,
    buildEdgeId,
    canBindTargetPort,
    deriveValidationTargets,
    edgeToSpec,
    extractPortFromHandle,
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
});
