import type {RunUiStatus} from './state/run-store';

const backendRunStatusMap: Record<string, RunUiStatus> = {
    running: 'running',
    stopped: 'stopped',
    completed: 'completed',
    failed: 'failed',
};

export const mapBackendRunStatus = (status: string): RunUiStatus =>
    backendRunStatusMap[status] ?? 'idle';

export const isRunActiveStatus = (status: RunUiStatus): boolean =>
    status === 'validating' || status === 'running';

export const isRunTerminalStatus = (status: RunUiStatus): boolean =>
    status === 'stopped' || status === 'completed' || status === 'failed';
