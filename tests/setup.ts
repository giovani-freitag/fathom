import { afterEach, beforeAll } from 'vitest';
import { cleanup } from '@testing-library/react';
import { observedSize } from './fixtures/observed-size.ts';

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
 * refuses to run in. What it reports is what the test asked for.
 */
beforeAll(() => {
    globalThis.ResizeObserver = class {
        private readonly announce: ResizeObserverCallback;

        constructor(announce: ResizeObserverCallback) {
            this.announce = announce;
        }

        observe(target: Element): void {
            this.announce(
                [{ target, contentRect: { ...observedSize } } as ResizeObserverEntry],
                this,
            );
        }

        unobserve(): void { /* nothing is tracked */ }
        disconnect(): void { /* nothing is tracked */ }
    };
});

/**
 * Gives jsdom the pointer plumbing the menu primitives open on.
 *
 * jsdom implements no pointer events and no capture, and a menu that opens on
 * `pointerdown` never opens without them — which reads in a test as a component
 * that renders nothing rather than as an environment missing an API.
 */
beforeAll(() => {
    // Assigned rather than filled in where missing: the DOM types say every one
    // of these exists, so a check against them reads as dead code to the linter
    // and to anybody who trusts the types over jsdom.
    globalThis.PointerEvent = class extends MouseEvent {} as typeof PointerEvent;
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => undefined;
    Element.prototype.releasePointerCapture = () => undefined;
    Element.prototype.scrollIntoView = () => undefined;
});
