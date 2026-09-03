import { describe, expect, it } from 'vitest';
import { alignSessions, collectSessions } from '../../../src/shared/core/settled-sessions.ts';
import { readSessions } from '../../../src/shared/core/draw-plan.ts';
import type { IndicatorInput, SessionRequest } from '../../../src/shared/core/draw-plan.ts';
import type { PriceBar, PriceBarWindow } from '../../../src/shared/core/price-bar.ts';
import { buildBar, buildRun, buildWindow } from '../../mocks/price-bars.ts';

const DAY_MS = 86_400_000;
const BAR_MS = 60_000;

/** A coarse bar of a declared width, so a test can close one inside a short run. */
function buildSession(openedAtMs: number, widthMs = DAY_MS): PriceBar {
    return { ...buildBar(openedAtMs, 100), closedAtMs: openedAtMs + widthMs };
}

function buildRung(bars: readonly PriceBar[], intervalMs = DAY_MS): PriceBarWindow {
    return { ...buildWindow(bars), intervalMs };
}

const DECLARED: Readonly<Record<string, SessionRequest>> = {
    session: { intervalMs: DAY_MS, reachingBack: 2 },
};

function buildInput(sessions: IndicatorInput['sessions']): IndicatorInput {
    return { bars: buildWindow([]), settings: {}, sessions };
}

describe('aligning a coarser rung to the drawn bars', () => {
    it('marks the bar a session turned over on, and only that one', () => {
        // Three bars a minute apart, with a session closing on the second.
        const bars = buildRun(3, () => 100);
        const closesOnTheSecond = buildSession(bars[1]!.openedAtMs - DAY_MS);

        const settled = alignSessions(bars, [closesOnTheSecond]);

        expect([...settled.turnsOver]).toEqual([0, 1, 0]);
    });

    it('says it has something once any bar has a settled session behind it', () => {
        const bars = buildRun(2, () => 100);

        const settled = alignSessions(bars, [buildSession(bars[0]!.openedAtMs - DAY_MS)]);

        expect(settled.hasAny).toBe(true);
    });

    it('says it has nothing when the rung is empty', () => {
        const settled = alignSessions(buildRun(3, () => 100), []);

        expect(settled.hasAny).toBe(false);
        expect(settled.perBar).toEqual([undefined, undefined, undefined]);
    });

    it('says it has nothing when no session had closed yet', () => {
        // The session is still forming over the whole window, so nothing in it
        // is knowable and every bar is left blank.
        const bars = buildRun(3, () => 100);

        const settled = alignSessions(bars, [buildSession(bars[0]!.openedAtMs)]);

        expect(settled.hasAny).toBe(false);
    });

    it('gives one entry per drawn bar, whatever the rung holds', () => {
        const bars = buildRun(5, () => 100);

        const settled = alignSessions(bars, [buildSession(-DAY_MS)]);

        expect(settled.perBar).toHaveLength(5);
        expect(settled.turnsOver).toHaveLength(5);
    });
});

describe('collecting what a reading declared', () => {
    it('hands it back under the name it declared, not the rung it asked with', () => {
        const bars = buildRun(3, () => 100);

        const collected = collectSessions(bars, new Map([[DAY_MS, buildRung([buildSession(-DAY_MS)])]]), DECLARED);

        expect(Object.keys(collected)).toEqual(['session']);
        expect(collected['session']?.hasAny).toBe(true);
    });

    it('hands back a blank one when the archive had no such rung', () => {
        // Present rather than absent: no venue publishes a candle for every
        // width, and the reading has to be able to say it has nothing to draw.
        const bars = buildRun(3, () => 100);

        const collected = collectSessions(bars, new Map(), DECLARED);

        expect(collected['session']).toBeDefined();
        expect(collected['session']?.hasAny).toBe(false);
        expect(collected['session']?.perBar).toHaveLength(3);
    });

    it('ignores a rung that arrived without being declared', () => {
        const supplied = new Map([[BAR_MS, buildRung([buildSession(-BAR_MS, BAR_MS)], BAR_MS)]]);

        const collected = collectSessions(buildRun(2, () => 100), supplied, DECLARED);

        expect(collected['session']?.hasAny).toBe(false);
    });

    it('collects nothing for a reading that declared nothing', () => {
        expect(collectSessions(buildRun(2, () => 100), new Map(), undefined)).toEqual({});
    });
});

describe('reading a session back', () => {
    it('throws on a name nothing was declared under, and names what was', () => {
        const input = buildInput({ daily: { hasAny: false, perBar: [], turnsOver: new Uint8Array(0) } });

        expect(() => readSessions(input, 'weekly')).toThrow(/'weekly'.*Declared: daily/);
    });

    it('says so plainly when nothing at all was declared', () => {
        expect(() => readSessions(buildInput({}), 'session')).toThrow(/Declared: \(none\)/);
    });

    it('returns what was declared', () => {
        const daily = { hasAny: true, perBar: [], turnsOver: new Uint8Array(0) };

        expect(readSessions(buildInput({ daily }), 'daily')).toBe(daily);
    });
});
