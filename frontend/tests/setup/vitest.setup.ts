import {afterAll, afterEach, beforeAll, beforeEach} from 'vitest';
import {cleanup} from '@testing-library/react';

import i18n, {defaultLanguage, localeStorageKey} from '../../src/shared/i18n/i18n';
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

beforeEach(async () => {
    await i18n.changeLanguage(defaultLanguage);
    window.localStorage.removeItem(localeStorageKey);
});

afterEach(() => {
    cleanup();
    server.resetHandlers();
});

afterAll(() => {
    server.close();
});
