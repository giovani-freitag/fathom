import { afterEach, beforeAll } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * Gives jsdom a canvas that reports no drawing context.
 *
 * jsdom logs a "not implemented" error for every `getContext` call, which buries
 * real failures in noise. Returning null is the state the rendering code already
 * has to handle, so the stub exercises that path rather than hiding it.
 */
beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = () => null;
});

/**
 * Unmounts whatever a test rendered.
 *
 * Testing Library only registers this itself when vitest is running with
 * globals, which this project is not: without it a second render leaves the
 * first one in the document and every query finds two of everything.
 */
afterEach(() => {
    cleanup();
});

/**
 * Gives jsdom a ResizeObserver that reports one size and stops.
 *
 * jsdom implements no layout, so nothing would ever observe a size and the
 * surface would stay at zero by zero — which is the one state its paint path
 * refuses to run in.
 */
beforeAll(() => {
    globalThis.ResizeObserver = class {
        private readonly announce: ResizeObserverCallback;

        constructor(announce: ResizeObserverCallback) {
            this.announce = announce;
        }

        observe(target: Element): void {
            this.announce(
                [{ target, contentRect: { width: 1_000, height: 600 } } as ResizeObserverEntry],
                this,
            );
        }

        unobserve(): void { /* nothing is tracked */ }
        disconnect(): void { /* nothing is tracked */ }
    };
});
