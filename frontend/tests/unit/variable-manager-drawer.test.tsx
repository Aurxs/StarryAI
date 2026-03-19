import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {VariableManagerDrawer} from '../../src/features/variable-manager/VariableManagerDrawer';
import {resetGraphStore, useGraphStore} from '../../src/shared/state/graph-store';

describe('VariableManagerDrawer', () => {
    beforeEach(() => {
        resetGraphStore();
    });

    it('renders variable list with type, initial value summary and usage count', async () => {
        useGraphStore.getState().createVariable({
            name: 'counter',
            value_kind: 'scalar.int',
            initial_value: 1,
        });
        useGraphStore.getState().upsertNode({
            node_id: 'v1',
            type_name: 'data.ref',
            title: 'Counter Ref',
            config: {
                variable_name: 'counter',
            },
        });

        render(<VariableManagerDrawer open onClose={() => undefined}/>);

        const item = await screen.findByTestId('variable-manager-item-counter');
        expect(within(item).getByText('counter')).toBeTruthy();
        expect(within(item).getByText('int')).toBeTruthy();
        expect(within(item).getByText('1')).toBeTruthy();
        expect(item.textContent).toContain('1');
    });

    it('warns before deleting a referenced variable and keeps stale references', async () => {
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
        useGraphStore.getState().createVariable({
            name: 'counter',
            value_kind: 'scalar.int',
            initial_value: 1,
        });
        useGraphStore.getState().upsertNode({
            node_id: 'v1',
            type_name: 'data.ref',
            title: 'Counter Ref',
            config: {
                variable_name: 'counter',
            },
        });

        render(<VariableManagerDrawer open onClose={() => undefined}/>);

        const item = await screen.findByTestId('variable-manager-item-counter');
        fireEvent.click(item);
        fireEvent.click(screen.getByTestId('variable-manager-delete-button'));

        expect(confirmSpy).toHaveBeenCalledTimes(1);
        expect(useGraphStore.getState().graph.metadata.data_registry?.variables).toEqual([]);
        expect(useGraphStore.getState().graph.nodes[0]?.config.variable_name).toBe('counter');

        confirmSpy.mockRestore();
    });

    it('selects a usage node and closes the drawer when clicking a usage entry', async () => {
        const onClose = vi.fn();
        useGraphStore.getState().createVariable({
            name: 'counter',
            value_kind: 'scalar.int',
            initial_value: 1,
        });
        useGraphStore.getState().upsertNode({
            node_id: 'v1',
            type_name: 'data.ref',
            title: 'Counter Ref',
            config: {
                variable_name: 'counter',
            },
        });

        render(<VariableManagerDrawer open onClose={onClose}/>);

        const usageButton = await screen.findByTestId('variable-manager-usage-v1-variable_name');
        fireEvent.click(usageButton);

        await waitFor(() => {
            expect(useGraphStore.getState().selectedNodeId).toBe('v1');
        });
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
