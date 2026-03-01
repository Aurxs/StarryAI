import {describe, expect, it} from 'vitest';

import {summarizeSyncMetrics} from '../../src/features/runtime-console/sync-metrics';

describe('summarizeSyncMetrics', () => {
    it('aggregates commit/abort counts and reasons across node metrics', () => {
        const summary = summarizeSyncMetrics({
            n1: {
                sync_committed: 2,
                sync_aborted: 0,
                sync_abort_reason: '',
            },
            n2: {
                sync_committed: 1,
                sync_aborted: 3,
                sync_abort_reason: 'timeout',
            },
            n3: {
                sync_committed: 0,
                sync_aborted: 2,
                sync_abort_reason: 'late',
            },
        });

        expect(summary.commitCount).toBe(3);
        expect(summary.abortCount).toBe(5);
        expect(summary.abortReasons).toEqual({
            timeout: 3,
            late: 2,
        });
    });

    it('maps missing abort reason to unknown (edge path)', () => {
        const summary = summarizeSyncMetrics({
            n1: {
                sync_committed: 0,
                sync_aborted: 1,
                sync_abort_reason: '',
            },
        });

        expect(summary.commitCount).toBe(0);
        expect(summary.abortCount).toBe(1);
        expect(summary.abortReasons).toEqual({
            unknown: 1,
        });
    });
});
