import {beforeEach, describe, expect, it} from 'vitest';

import {
    clearGlobalInfoMessage,
    dequeueGlobalInfoMessage,
    notifyUser,
    pushGlobalInfoMessage,
    removeGlobalInfoMessageById,
    resetGlobalInfoStore,
    useGlobalInfoStore,
} from '../../../src/shared/state/global-info-store';

describe('global info store', () => {
    beforeEach(() => {
        resetGlobalInfoStore();
    });

    it('queues messages in order and preserves level', () => {
        notifyUser.info('first');
        notifyUser.error('second');

        const state = useGlobalInfoStore.getState();
        expect(state.messages).toHaveLength(2);
        expect(state.messages[0]).toMatchObject({message: 'first', level: 'info'});
        expect(state.messages[1]).toMatchObject({message: 'second', level: 'error'});
    });

    it('dequeues and clears messages', () => {
        pushGlobalInfoMessage('m1');
        pushGlobalInfoMessage('m2');

        dequeueGlobalInfoMessage();
        expect(useGlobalInfoStore.getState().messages).toHaveLength(1);
        expect(useGlobalInfoStore.getState().messages[0].message).toBe('m2');

        clearGlobalInfoMessage();
        expect(useGlobalInfoStore.getState().messages).toHaveLength(0);
    });

    it('ignores blank messages', () => {
        pushGlobalInfoMessage('   ');
        expect(useGlobalInfoStore.getState().messages).toHaveLength(0);
    });

    it('removes message by id', () => {
        pushGlobalInfoMessage('m1');
        pushGlobalInfoMessage('m2');
        const targetId = useGlobalInfoStore.getState().messages[0].id;

        removeGlobalInfoMessageById(targetId);

        const state = useGlobalInfoStore.getState();
        expect(state.messages).toHaveLength(1);
        expect(state.messages[0].message).toBe('m2');
    });
});
