import {afterAll, afterEach, beforeAll} from 'vitest';
import {cleanup} from '@testing-library/react';

import {server} from '../mocks/server';

class ResizeObserverStub {
    observe(): void {
    }

    unobserve(): void {
    }

    disconnect(): void {
    }
}

if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = ResizeObserverStub as typeof ResizeObserver;
}

beforeAll(() => {
    server.listen({onUnhandledRequest: 'error'});
});

afterEach(() => {
    cleanup();
    server.resetHandlers();
});

afterAll(() => {
    server.close();
});
