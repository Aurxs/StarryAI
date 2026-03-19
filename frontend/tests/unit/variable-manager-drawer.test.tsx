import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {VariableManagerDrawer} from '../../src/features/variable-manager/VariableManagerDrawer';
import {resetGraphStore, useGraphStore} from '../../src/shared/state/graph-store';

const getListOrder = (): string[] =>
    within(screen.getByTestId('variable-manager-list'))
        .getAllByTestId(/variable-manager-item-/)
        .map((item) => item.getAttribute('data-testid') ?? '');

describe('VariableManagerDrawer', () => {
    beforeEach(() => {
        resetGraphStore();
    });

    it('renders the first variable selected by default with inline edit panel', async () => {
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
        expect(within(item).getByText('整数')).toBeTruthy();
        expect(within(item).getByText('1')).toBeTruthy();
        expect(item.textContent).toContain('1');
        expect(screen.getByTestId('variable-manager-edit-panel')).toBeTruthy();
        expect(screen.getByTestId('variable-manager-usage-v1-variable_name')).toBeTruthy();
    });

    it('moves the clicked variable to the top and expands its editor below', async () => {
        useGraphStore.getState().createVariable({
            name: 'counter',
            value_kind: 'scalar.int',
            initial_value: 1,
        });
        useGraphStore.getState().createVariable({
            name: 'balance',
            value_kind: 'scalar.float',
            initial_value: 2.5,
        });

        render(<VariableManagerDrawer open onClose={() => undefined}/>);

        expect(getListOrder()).toEqual([
            'variable-manager-item-counter',
            'variable-manager-item-balance',
        ]);

        fireEvent.click(screen.getByTestId('variable-manager-item-balance'));

        await waitFor(() => {
            expect(getListOrder()).toEqual([
                'variable-manager-item-balance',
                'variable-manager-item-counter',
            ]);
            expect(screen.getByTestId('variable-manager-edit-overlay')).toBeTruthy();
            expect(screen.getByTestId('variable-manager-edit-panel')).toBeTruthy();
        });
    });

    it('shows a full create overlay and moves the new variable to the top after save', async () => {
        useGraphStore.getState().createVariable({
            name: 'counter',
            value_kind: 'scalar.int',
            initial_value: 1,
        });
        useGraphStore.getState().createVariable({
            name: 'balance',
            value_kind: 'scalar.float',
            initial_value: 2.5,
        });

        render(<VariableManagerDrawer open onClose={() => undefined}/>);

        fireEvent.click(screen.getByTestId('variable-manager-new-button'));

        expect(screen.getByTestId('variable-manager-create-overlay')).toBeTruthy();
        expect(screen.queryByTestId('variable-manager-edit-panel')).toBeNull();
        expect(screen.queryByTestId('variable-manager-usage-empty')).toBeNull();

        fireEvent.change(screen.getByTestId('variable-manager-name-input'), {
            target: {value: 'fresh'},
        });
        fireEvent.change(screen.getByTestId('variable-manager-scalar-input'), {
            target: {value: '3'},
        });
        fireEvent.click(screen.getByTestId('variable-manager-save-button'));

        await waitFor(() => {
            expect(screen.queryByTestId('variable-manager-create-overlay')).toBeNull();
        });
        await waitFor(() => {
            expect(getListOrder()).toEqual([
                'variable-manager-item-fresh',
                'variable-manager-item-counter',
                'variable-manager-item-balance',
            ]);
            expect(screen.getByTestId('variable-manager-edit-overlay')).toBeTruthy();
            expect(screen.getByTestId('variable-manager-edit-panel')).toBeTruthy();
        });
    });

    it('warns before deleting a referenced variable, keeps stale references, and returns to create overlay when empty', async () => {
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

        fireEvent.click(screen.getByTestId('variable-manager-delete-button'));

        expect(confirmSpy).toHaveBeenCalledTimes(1);
        expect(useGraphStore.getState().graph.metadata.data_registry?.variables).toEqual([]);
        expect(useGraphStore.getState().graph.nodes[0]?.config.variable_name).toBe('counter');
        expect(screen.getByTestId('variable-manager-create-overlay')).toBeTruthy();

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
