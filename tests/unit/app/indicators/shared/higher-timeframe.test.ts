import { describe, expect, it } from 'vitest';
import { holdLastClosed } from '../../../../../src/app/indicators/shared/higher-timeframe.ts';
import type { PriceBar } from '../../../../../src/shared/core/price-bar.ts';
import { buildBar, buildRun } from '../../../../mocks/price-bars.ts';

const DAY_MS = 86_400_000;

/** A coarse bar of a declared width, priced so each is told from the others. */
function buildSession(openedAtMs: number, closePrice: number, widthMs = DAY_MS): PriceBar {
    return { ...buildBar(openedAtMs, closePrice), closedAtMs: openedAtMs + widthMs };
}

describe('holdLastClosed', () => {
    it('holds one settled session across every bar that followed it', () => {
        const sessions = [buildSession(-DAY_MS, 50)];
        const bars = buildRun(3, () => 100);

        const held = holdLastClosed(bars, sessions);

        expect(held.map((one) => one?.closePrice)).toEqual([50, 50, 50]);
    });

    it('shows nothing before any session has closed', () => {
        // The first day of a recording has no day before it, and drawing the
        // day being lived through would be drawing a figure not yet settled.
        const sessions = [buildSession(0, 50)];
        const bars = buildRun(3, () => 100);

        const held = holdLastClosed(bars, sessions);

        expect(held).toEqual([undefined, undefined, undefined]);
    });

    it('never reaches into a session still forming', () => {
        // The whole of the rule. The session opening at nought closes a minute
        // into the run, so the bars before that must not see its figures — they
        // are not knowable yet, and showing them is showing the future.
        const sessions = [buildSession(0, 50, 120_000)];
        const bars = buildRun(4, () => 100);

        const held = holdLastClosed(bars, sessions);

        expect(held.map((one) => one?.closePrice)).toEqual([undefined, undefined, 50, 50]);
    });

    it('counts a session that closed as a bar opened, because that is when it became knowable', () => {
        // Closes at 120_000, which is exactly when the third bar opens. Held
        // back a bar, the level a whole session agreed on arrives late.
        const sessions = [buildSession(0, 50, 120_000)];
        const bars = buildRun(3, () => 100);

        const held = holdLastClosed(bars, sessions);

        expect(held[2]?.closePrice).toBe(50);
    });

    it('moves on to the newer session once that one has closed too', () => {
        const sessions = [buildSession(-120_000, 50, 120_000), buildSession(0, 70, 120_000)];
        const bars = buildRun(4, () => 100);

        const held = holdLastClosed(bars, sessions);

        expect(held.map((one) => one?.closePrice)).toEqual([50, 50, 70, 70]);
    });

    it('says nothing at all when the rung was never fetched', () => {
        const held = holdLastClosed(buildRun(2, () => 100), []);

        expect(held).toEqual([undefined, undefined]);
    });
});
