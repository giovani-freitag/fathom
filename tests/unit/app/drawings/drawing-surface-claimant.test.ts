import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Drawing } from '../../../../src/shared/core/drawing.ts';
import { DEFAULT_PREFERENCES, type PreferencesService } from '../../../../src/app/services/preferences-service.ts';
import { DrawingsController } from '../../../../src/app/drawings/drawings-controller.ts';
import { DrawingSurfaceClaimant } from '../../../../src/app/drawings/drawing-surface-claimant.ts';
import { ViewportProjector } from '../../../../src/app/core/viewport-projector.ts';

const WIDTH_PX = 1_000;
const HEIGHT_PX = 500;

const projector = new ViewportProjector({
    viewport: { fromMs: 0, toMs: 100_000, lowPrice: 0, highPrice: 100 },
    width: WIDTH_PX,
    height: HEIGHT_PX,
});

const STORED_LEVEL: Drawing = {
    id: 'level',
    kind: 'horizontal-line',
    instrumentSymbol: 'BTCUSDT',
    anchors: [{ atMs: 50_000, price: 50 }],
    tone: 'phosphor',
};

interface Harness {
    readonly claimant: DrawingSurfaceClaimant;
    readonly drawings: DrawingsController;
}

function buildHarness(stored: readonly Drawing[] = [], symbol: string | null = 'BTCUSDT'): Harness {
    const drawings = new DrawingsController({
        preferences: {
            read: () => ({ ...DEFAULT_PREFERENCES, drawings: stored }),
            write: vi.fn(),
        } as unknown as PreferencesService,
        readInstrumentSymbol: () => symbol,
        newId: () => 'made',
    });

    return {
        drawings,
        claimant: new DrawingSurfaceClaimant({
            drawings,
            readProjector: () => projector,
            readInstrumentSymbol: () => symbol,
        }),
    };
}

/** Where a price sits on this surface. */
function yOf(price: number): number {
    return projector.priceToY(price);
}

describe('DrawingSurfaceClaimant offered a press', () => {
    let harness: Harness;

    beforeEach(() => { harness = buildHarness([STORED_LEVEL]); });

    it('takes it while a tool is armed', () => {
        // Left to the viewport, arming a tool would pan the chart out from under
        // the very line the reader is placing.
        harness.drawings.arm('trend-line');

        expect(harness.claimant.offerPress({ x: 100, y: 100 })).toBe(true);
    });

    it('takes it when a mark is under the pointer', () => {
        expect(harness.claimant.offerPress({ x: 100, y: yOf(50) })).toBe(true);
    });

    it('leaves it to the viewport on bare chart', () => {
        expect(harness.claimant.offerPress({ x: 100, y: yOf(10) })).toBe(false);
    });

    it('leaves a mark drawn about another contract to the viewport', () => {
        const foreign = buildHarness([{ ...STORED_LEVEL, instrumentSymbol: 'ETHUSDT' }]);

        expect(foreign.claimant.offerPress({ x: 100, y: yOf(50) })).toBe(false);
    });

    it('selects the mark it took the press for', () => {
        harness.claimant.offerPress({ x: 100, y: yOf(50) });

        expect(harness.drawings.store.read().selectedId).toBe('level');
    });

    it('lets go of what was selected when the press lands elsewhere', () => {
        harness.claimant.offerPress({ x: 100, y: yOf(50) });

        harness.claimant.offerPress({ x: 100, y: yOf(10) });

        expect(harness.drawings.store.read().selectedId).toBeNull();
    });

    it('opens a mark of the armed kind where the press landed', () => {
        harness.drawings.arm('horizontal-line');

        harness.claimant.offerPress({ x: 100, y: yOf(30) });

        expect(harness.drawings.store.read().draft?.anchors).toEqual([
            { atMs: projector.xToTime(100), price: projector.yToPrice(yOf(30)) },
        ]);
    });
});

describe('DrawingSurfaceClaimant carrying a claim', () => {
    let harness: Harness;

    beforeEach(() => {
        harness = buildHarness();
        harness.drawings.arm('trend-line');
        harness.claimant.offerPress({ x: 100, y: yOf(20) });
    });

    it('follows the pointer with the mark being drawn', () => {
        harness.claimant.moveClaim({ x: 400, y: yOf(40) });

        expect(harness.drawings.store.read().draft?.anchors[1])
            .toEqual({ atMs: projector.xToTime(400), price: projector.yToPrice(yOf(40)) });
    });

    it('keeps the mark once the claim is over', () => {
        harness.claimant.moveClaim({ x: 400, y: yOf(40) });
        harness.claimant.settleClaim();

        expect(harness.drawings.store.read().drawings).toHaveLength(1);
    });
});

describe('DrawingSurfaceClaimant with no contract on the chart', () => {
    it('leaves every press to the viewport', () => {
        const bare = buildHarness([], null);
        bare.drawings.arm('trend-line');

        expect(bare.claimant.offerPress({ x: 100, y: 100 })).toBe(true);
    });

    it('opens no mark it could not say what contract it was about', () => {
        const bare = buildHarness([], null);
        bare.drawings.arm('trend-line');

        bare.claimant.offerPress({ x: 100, y: 100 });

        expect(bare.drawings.store.read().draft).toBeNull();
    });
});

describe('DrawingSurfaceClaimant telling a press from a drag', () => {
    let harness: Harness;

    beforeEach(() => { harness = buildHarness([STORED_LEVEL]); });

    it('leaves the mark where it was drawn when the press only twitched', () => {
        // No hand is perfectly still between pressing and letting go, and a
        // reader who meant to select a level should not find it a tick lower.
        harness.claimant.offerPress({ x: 500, y: yOf(50) });
        harness.claimant.moveClaim({ x: 502, y: yOf(50) + 2 });
        harness.claimant.settleClaim();

        expect(harness.drawings.store.read().drawings[0]?.anchors[0]?.price).toBe(50);
    });

    it('selects the mark all the same, which is what the press was for', () => {
        harness.claimant.offerPress({ x: 500, y: yOf(50) });
        harness.claimant.moveClaim({ x: 502, y: yOf(50) + 2 });
        harness.claimant.settleClaim();

        expect(harness.drawings.store.read().selectedId).toBe('level');
    });

    it('records no step back for a press that moved nothing', () => {
        harness.claimant.offerPress({ x: 500, y: yOf(50) });
        harness.claimant.moveClaim({ x: 502, y: yOf(50) + 2 });
        harness.claimant.settleClaim();

        expect(harness.drawings.store.read().canUndo).toBe(false);
    });

    it('moves the mark once the pointer has gone somewhere', () => {
        harness.claimant.offerPress({ x: 500, y: yOf(50) });
        harness.claimant.moveClaim({ x: 500, y: yOf(40) });
        harness.claimant.settleClaim();

        expect(harness.drawings.store.read().drawings[0]?.anchors[0]?.price).toBeCloseTo(40);
    });

    it('carries the whole way, not only what was left after the threshold', () => {
        // The mark follows the pointer: a drag that dropped its first pixels
        // would leave the line lagging the finger by however far it took to
        // decide this was a drag at all.
        harness.claimant.offerPress({ x: 500, y: yOf(50) });
        harness.claimant.moveClaim({ x: 500, y: yOf(50) + 5 });
        harness.claimant.moveClaim({ x: 500, y: yOf(30) });
        harness.claimant.settleClaim();

        expect(harness.drawings.store.read().drawings[0]?.anchors[0]?.price).toBeCloseTo(30);
    });

    it('keeps carrying a drag that comes back past where it started', () => {
        // Deciding once is what makes a drag a drag: re-asking every move
        // would drop the ones near the press and strand the mark out where
        // the pointer last was far enough away.
        harness.claimant.offerPress({ x: 500, y: yOf(50) });
        harness.claimant.moveClaim({ x: 500, y: yOf(30) });
        harness.claimant.moveClaim({ x: 500, y: yOf(50) + 1 });
        harness.claimant.settleClaim();

        expect(harness.drawings.store.read().drawings[0]?.anchors[0]?.price).toBeCloseTo(49.8, 1);
    });

    it('measures the next press from where that one went down', () => {
        harness.claimant.offerPress({ x: 500, y: yOf(50) });
        harness.claimant.moveClaim({ x: 500, y: yOf(30) });
        harness.claimant.settleClaim();

        harness.claimant.offerPress({ x: 500, y: yOf(30) });
        harness.claimant.moveClaim({ x: 501, y: yOf(30) + 1 });
        harness.claimant.settleClaim();

        expect(harness.drawings.store.read().drawings[0]?.anchors[0]?.price).toBeCloseTo(30);
    });
});

describe('DrawingSurfaceClaimant asked what the pointer should look like', () => {
    let harness: Harness;

    beforeEach(() => { harness = buildHarness([STORED_LEVEL]); });

    it('shows a mark under the pointer as something to grab', () => {
        expect(harness.claimant.describeCursor({ x: 500, y: yOf(50) })).toBe('move');
    });

    it('says nothing about bare chart, which the plot already answers for', () => {
        expect(harness.claimant.describeCursor({ x: 500, y: yOf(10) })).toBeNull();
    });

    it('says nothing while a tool is armed, when every press draws anyway', () => {
        // The mark under the pointer is not what the next press is about, and
        // showing it as grabbable would say the tool had been put down.
        harness.drawings.arm('horizontal-line');

        expect(harness.claimant.describeCursor({ x: 500, y: yOf(50) })).toBeNull();
    });
});
