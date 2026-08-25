import { beforeAll } from 'vitest';

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
