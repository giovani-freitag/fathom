import { classifyBar, type PriceBar } from '../../../src/shared/core/price-bar.ts';
import { describe, expect, it } from 'vitest';

function buildBar(overrides: Partial<PriceBar> = {}): PriceBar {
    return {
        openedAtMs: 60_000,
        closedAtMs: 120_000,
        openPrice: 100, highPrice: 110, lowPrice: 90, closePrice: 105,
        expectedFrames: 60,
        frameCount: 60,
        isClosed: true,
        firstFrameAtMs: 60_000,
        lastFrameAtMs: 119_000,
        ...overrides,
    };
}

describe('classifyBar', () => {
    it('calls a bucket whole when every second of it was recorded', () => {
        expect(classifyBar(buildBar())).toBe('whole');
    });

    it('calls a closed bucket short of frames partial', () => {
        expect(classifyBar(buildBar({ frameCount: 3 }))).toBe('partial');
    });

    it('calls a bucket that can still grow forming, however few frames it holds', () => {
        // The distinction the wire contract exists for: a bar the collector is
        // still filling is not a bar it missed, and drawing both as a fault
        // would mark the newest bar as broken for almost all of its own width.
        expect(classifyBar(buildBar({ frameCount: 1, isClosed: false }))).toBe('forming');
    });
});
