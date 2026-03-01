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

const buildRect = (width: number, height: number): DOMRect => {
    if (typeof DOMRect !== 'undefined' && typeof DOMRect.fromRect === 'function') {
        return DOMRect.fromRect({x: 0, y: 0, width, height});
    }
    return {
        x: 0,
        y: 0,
        width,
        height,
        top: 0,
        left: 0,
        right: width,
        bottom: height,
        toJSON: () => ({}),
    } as DOMRect;
};

const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
    const measured = originalGetBoundingClientRect.call(this);
    if (measured.width > 0 && measured.height > 0) {
        return measured;
    }
    const widthFromStyle = Number.parseFloat(this.style.width || '');
    const heightFromStyle = Number.parseFloat(this.style.height || '');
    const width = Number.isFinite(widthFromStyle) && widthFromStyle > 0 ? widthFromStyle : 1280;
    const height = Number.isFinite(heightFromStyle) && heightFromStyle > 0 ? heightFromStyle : 720;
    return buildRect(width, height);
};

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
