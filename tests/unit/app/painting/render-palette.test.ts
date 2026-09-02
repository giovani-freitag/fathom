import { afterEach, describe, expect, it } from 'vitest';
import { applyPaletteTheme, RENDER_PALETTE } from '../../../../src/app/painting/render-palette.ts';

/** The smallest ratio WCAG calls readable for text at this size. */
const READABLE_RATIO = 4.5;

/**
 * How much lighter one colour is than another, on WCAG's own scale.
 *
 * @param first - A hex colour.
 * @param second - The colour behind it.
 * @returns The ratio, from 1 for identical to 21 for black on white.
 */
function contrastRatio(first: string, second: string): number {
    const [high, low] = [luminanceOf(first), luminanceOf(second)].sort((a, b) => b - a) as [number, number];
    return (high + 0.05) / (low + 0.05);
}

function luminanceOf(hex: string): number {
    const channels = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255);
    const linear = channels.map((one) => (one <= 0.03928 ? one / 12.92 : ((one + 0.055) / 1.055) ** 2.4));
    return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

describe('what a figure written along an axis is drawn in', () => {
    afterEach(() => {
        applyPaletteTheme('dark');
    });

    it('is readable against the chart in the dark', () => {
        // Small, monospaced, and the only thing on the screen that says what
        // the rest of it is worth. It shared the muted ink and read at 4.3.
        applyPaletteTheme('dark');

        expect(contrastRatio(RENDER_PALETTE.axisLabel, RENDER_PALETTE.surface))
            .toBeGreaterThanOrEqual(READABLE_RATIO);
    });

    it('is readable against the chart in the light', () => {
        applyPaletteTheme('light');

        expect(contrastRatio(RENDER_PALETTE.axisLabel, RENDER_PALETTE.surface))
            .toBeGreaterThanOrEqual(READABLE_RATIO);
    });

    it('stays quieter than what the chart says outright', () => {
        // Readable is not the same as loud. An axis that competes with the
        // reading is an axis a reader has to look past.
        applyPaletteTheme('dark');

        expect(contrastRatio(RENDER_PALETTE.axisLabel, RENDER_PALETTE.surface))
            .toBeLessThan(contrastRatio(RENDER_PALETTE.inkPrimary, RENDER_PALETTE.surface));
    });
});
