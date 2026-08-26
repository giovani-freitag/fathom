import { describe, expect, it } from 'vitest';
import { buildBackgroundPainters, buildFieldPainters } from '../../../../src/app/indicators/layer-painters.ts';
import type { RenderRequest } from '../../../../src/app/painting/render-types.ts';

function buildRequest(overrides: Partial<RenderRequest>): RenderRequest {
    return {
        isVolumeProfileVisible: false,
        isCandleOverlayVisible: false,
        isTradeOverlayVisible: false,
        ...overrides,
    } as unknown as RenderRequest;
}

describe('the painters the layers contribute', () => {
    it('draws the profile under the price and what crossed it over both', () => {
        // The order is each layer's own claim now rather than the sequence
        // somebody wrote in the renderer, so what it comes to is worth reading
        // back: an execution must never be hidden by the price it happened at.
        const painters = buildFieldPainters();

        expect(painters.map((painter) => painter.constructor.name))
            .toEqual(['VolumeProfilePainter', 'CandlePainter', 'TradePainter']);
    });

    it('draws nothing at all on a chart showing none of them', () => {
        const drawn = buildFieldPainters().filter((painter) => painter.isDrawn(buildRequest({})));

        expect(drawn).toEqual([]);
    });

    it('draws only the one whose reading is on the chart', () => {
        const request = buildRequest({ isCandleOverlayVisible: true });

        const drawn = buildFieldPainters().filter((painter) => painter.isDrawn(request));

        expect(drawn.length).toBe(1);
    });

    it('offers a background painter that lets go of what it held', () => {
        const painters = buildBackgroundPainters();

        for (const painter of painters) {
            painter.dispose();
        }

        expect(painters.length).toBeGreaterThan(0);
    });
});
