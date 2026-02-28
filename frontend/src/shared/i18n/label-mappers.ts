import type {TFunction} from 'i18next';

import type {RunUiStatus} from '../state/run-store';
import type {LeftPanelKey, RightPanelKey} from '../state/ui-store';

const runStatusKeyMap: Record<RunUiStatus, string> = {
    idle: 'run.status.idle',
    validating: 'run.status.validating',
    running: 'run.status.running',
    stopped: 'run.status.stopped',
    completed: 'run.status.completed',
    failed: 'run.status.failed',
};

const leftPanelKeyMap: Record<LeftPanelKey, string> = {
    'node-library': 'workbench.panel.nodeLibrary',
    'graph-outline': 'workbench.panel.graphOutline',
};

const rightPanelKeyMap: Record<RightPanelKey, string> = {
    'node-config': 'workbench.panel.nodeConfig',
    'run-inspector': 'workbench.panel.runInspector',
};

export const translateRunStatus = (t: TFunction, value: RunUiStatus): string =>
    t(runStatusKeyMap[value], {defaultValue: value});

export const translateLeftPanel = (t: TFunction, value: LeftPanelKey): string =>
    t(leftPanelKeyMap[value], {defaultValue: value});

export const translateRightPanel = (t: TFunction, value: RightPanelKey): string =>
    t(rightPanelKeyMap[value], {defaultValue: value});
