export interface SyncMetricsSummary {
    commitCount: number;
    abortCount: number;
    abortReasons: Record<string, number>;
}

const toNonNegativeInt = (value: unknown): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return 0;
    }
    const rounded = Math.trunc(value);
    return rounded > 0 ? rounded : 0;
};

const toAbortReason = (value: unknown): string | null => {
    if (typeof value !== 'string') {
        return null;
    }
    const normalized = value.trim();
    return normalized || null;
};

export const summarizeSyncMetrics = (
    nodeMetrics: Record<string, Record<string, unknown>> | null | undefined,
): SyncMetricsSummary => {
    if (!nodeMetrics) {
        return {
            commitCount: 0,
            abortCount: 0,
            abortReasons: {},
        };
    }

    let commitCount = 0;
    let abortCount = 0;
    const abortReasons: Record<string, number> = {};

    for (const metrics of Object.values(nodeMetrics)) {
        commitCount += toNonNegativeInt(metrics.sync_committed);
        const nodeAbortCount = toNonNegativeInt(metrics.sync_aborted);
        abortCount += nodeAbortCount;
        if (nodeAbortCount <= 0) {
            continue;
        }
        const reason = toAbortReason(metrics.sync_abort_reason) ?? 'unknown';
        abortReasons[reason] = (abortReasons[reason] ?? 0) + nodeAbortCount;
    }

    return {
        commitCount,
        abortCount,
        abortReasons,
    };
};
