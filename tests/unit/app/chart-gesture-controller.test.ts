import type { ChartViewport } from '../../../src/app/core/chart-viewport.ts';
import { ChartGestureController } from '../../../src/app/core/chart-gesture-controller.ts';
import { describe, expect, it } from 'vitest';
import { createGestureSurface, type GestureSurfaceMock } from '../../mocks/gesture-surface.ts';
import { resolveChartLayout } from '../../../src/app/painting/chart-layout.ts';

const VIEWPORT: ChartViewport = {
    fromMs: 1_000_000,
    toMs: 1_900_000,
    lowPrice: 78_000,
    highPrice: 79_000,
};

interface Harness {
    readonly controller: ChartGestureController;
    readonly surface: GestureSurfaceMock;
}

function buildHarness(): Harness {
    const surface = createGestureSurface(VIEWPORT);
    const controller = new ChartGestureController({
        surface: surface.surface,
        readViewport: surface.readViewport,
        readSurfaceSize: () => ({ width: surface.width, height: surface.height }),
        readLayout: () => resolveChartLayout({
            cssWidth: surface.width,
            cssHeight: surface.height,
            isVolumeProfileVisible: true,
        }),
        onView: (request) => surface.published.push(request),
        onPointerMove: (pointer) => surface.pointers.push(pointer),
    });
    controller.attach();
    return { controller, surface };
}

function dragBy(surface: GestureSurfaceMock, deltaX: number, deltaY: number): void {
    surface.fire('pointerdown', { pointerId: 1, clientX: 500, clientY: 250 });
    surface.fire('pointermove', { pointerId: 1, clientX: 500 + deltaX, clientY: 250 + deltaY });
}

describe('ChartGestureController', () => {
    it('reveals earlier time when the surface is dragged right', () => {
        const { surface } = buildHarness();

        dragBy(surface, 100, 0);

        expect(surface.published.at(-1)?.viewport.fromMs).toBeLessThan(VIEWPORT.fromMs);
    });

    it('reveals higher prices when the surface is dragged down', () => {
        const { surface } = buildHarness();

        dragBy(surface, 0, 50);

        expect(surface.published.at(-1)?.viewport.lowPrice).toBeGreaterThan(VIEWPORT.lowPrice);
    });

    it('keeps both spans unchanged while dragging', () => {
        const { surface } = buildHarness();

        dragBy(surface, 120, 40);

        const published = surface.published.at(-1)!.viewport;
        expect(published.toMs - published.fromMs).toBeCloseTo(900_000, 6);
    });

    it('recomputes from the gesture origin rather than accumulating', () => {
        const { surface } = buildHarness();
        surface.fire('pointerdown', { pointerId: 1, clientX: 500, clientY: 250 });

        surface.fire('pointermove', { pointerId: 1, clientX: 600, clientY: 250 });
        surface.fire('pointermove', { pointerId: 1, clientX: 600, clientY: 250 });

        expect(surface.published[0]?.viewport.fromMs).toBe(surface.published[1]?.viewport.fromMs);
    });

    it('leaves the live edge when the drag ends in the past', () => {
        const { surface } = buildHarness();

        dragBy(surface, 400, 0);

        expect(surface.published.at(-1)?.isFollowingLive).toBe(false);
    });

    it('narrows the time span when two fingers spread apart', () => {
        const { surface } = buildHarness();
        surface.fire('pointerdown', { pointerId: 1, clientX: 400, clientY: 250 });
        surface.fire('pointerdown', { pointerId: 2, clientX: 600, clientY: 250 });

        surface.fire('pointermove', { pointerId: 2, clientX: 800, clientY: 250 });

        const published = surface.published.at(-1)!.viewport;
        expect(published.toMs - published.fromMs).toBeLessThan(900_000);
    });

    it('ignores a pinch narrower than a finger width', () => {
        const { surface } = buildHarness();
        surface.fire('pointerdown', { pointerId: 1, clientX: 500, clientY: 250 });
        surface.fire('pointerdown', { pointerId: 2, clientX: 505, clientY: 250 });

        surface.fire('pointermove', { pointerId: 2, clientX: 508, clientY: 250 });

        const published = surface.published.at(-1)!.viewport;
        expect(published.toMs - published.fromMs).toBeCloseTo(900_000, 6);
    });

    it('widens the time span on a downward wheel', () => {
        const { surface } = buildHarness();

        surface.fire('wheel', { clientX: 500, clientY: 250, deltaY: 120 });

        const published = surface.published.at(-1)!.viewport;
        expect(published.toMs - published.fromMs).toBeGreaterThan(900_000);
    });

    it('scales the price axis instead when the wheel carries shift', () => {
        const { surface } = buildHarness();

        surface.fire('wheel', { clientX: 500, clientY: 250, deltaY: 120, shiftKey: true });

        const published = surface.published.at(-1)!.viewport;
        expect([
            published.toMs - published.fromMs,
            published.highPrice - published.lowPrice > 1_000,
        ]).toEqual([900_000, true]);
    });

    it('returns to the live edge on a double click', () => {
        const { surface } = buildHarness();

        surface.fire('dblclick', { clientX: 500, clientY: 250 });

        expect(surface.published.at(-1)?.isFollowingLive).toBe(true);
    });

    it('reports the pointer position for the crosshair', () => {
        const { surface } = buildHarness();

        surface.fire('pointermove', { pointerId: 9, clientX: 320, clientY: 180 });

        expect(surface.pointers.at(-1)).toEqual({ x: 320, y: 180 });
    });

    it('clears the pointer when it leaves the surface', () => {
        const { surface } = buildHarness();

        surface.fire('pointerleave', {});

        expect(surface.pointers.at(-1)).toBeNull();
    });

    it('removes every listener on detach', () => {
        const { controller, surface } = buildHarness();

        controller.detach();

        expect(surface.listenerCount()).toBe(0);
    });

    it('refuses to attach twice', () => {
        const { controller } = buildHarness();

        expect(() => { controller.attach(); }).toThrow();
    });
});

/** With a 1000x500 surface the plot ends at x=850 and y=478. */
const PRICE_SCALE_X = 900;
const TIME_SCALE_Y = 490;

describe('ChartGestureController when the reader chooses a price band', () => {
    it('stops recentring after a vertical drag', () => {
        const { surface } = buildHarness();

        dragBy(surface, 0, 120);

        expect(surface.published.at(-1)?.isFollowingPrice).toBe(false);
    });

    it('leaves recentring alone when the drag is purely horizontal', () => {
        const { surface } = buildHarness();

        dragBy(surface, 150, 0);

        expect(surface.published.at(-1)?.isFollowingPrice).toBeUndefined();
    });

    it('stops recentring after the price is zoomed', () => {
        const { surface } = buildHarness();

        surface.fire('wheel', { clientX: 500, clientY: 250, deltaY: 120, shiftKey: true });

        expect(surface.published.at(-1)?.isFollowingPrice).toBe(false);
    });

    it('re-engages recentring on a double click', () => {
        const { surface } = buildHarness();

        surface.fire('dblclick', { clientX: 500, clientY: 250 });

        expect(surface.published.at(-1)?.isFollowingPrice).toBe(true);
    });
});

describe('ChartGestureController when an axis is dragged', () => {
    it('widens the price span when the price scale is dragged down', () => {
        const { surface } = buildHarness();

        surface.fire('pointerdown', { pointerId: 1, clientX: PRICE_SCALE_X, clientY: 250 });
        surface.fire('pointermove', { pointerId: 1, clientX: PRICE_SCALE_X, clientY: 430 });

        const published = surface.published.at(-1)!.viewport;
        expect(published.highPrice - published.lowPrice).toBeGreaterThan(1_000);
    });

    it('narrows the price span when the price scale is dragged up', () => {
        const { surface } = buildHarness();

        surface.fire('pointerdown', { pointerId: 1, clientX: PRICE_SCALE_X, clientY: 250 });
        surface.fire('pointermove', { pointerId: 1, clientX: PRICE_SCALE_X, clientY: 70 });

        const published = surface.published.at(-1)!.viewport;
        expect(published.highPrice - published.lowPrice).toBeLessThan(1_000);
    });

    it('holds the time span while the price scale is dragged', () => {
        const { surface } = buildHarness();

        surface.fire('pointerdown', { pointerId: 1, clientX: PRICE_SCALE_X, clientY: 250 });
        surface.fire('pointermove', { pointerId: 1, clientX: PRICE_SCALE_X, clientY: 430 });

        const published = surface.published.at(-1)!.viewport;
        expect(published.toMs - published.fromMs).toBeCloseTo(900_000, 6);
    });

    it('keeps the scale centred, so the middle price stays put', () => {
        const { surface } = buildHarness();

        surface.fire('pointerdown', { pointerId: 1, clientX: PRICE_SCALE_X, clientY: 250 });
        surface.fire('pointermove', { pointerId: 1, clientX: PRICE_SCALE_X, clientY: 430 });

        const published = surface.published.at(-1)!.viewport;
        expect((published.highPrice + published.lowPrice) / 2).toBeCloseTo(78_500, 6);
    });

    it('restores the original span when the drag returns to where it began', () => {
        const { surface } = buildHarness();

        surface.fire('pointerdown', { pointerId: 1, clientX: PRICE_SCALE_X, clientY: 250 });
        surface.fire('pointermove', { pointerId: 1, clientX: PRICE_SCALE_X, clientY: 430 });
        surface.fire('pointermove', { pointerId: 1, clientX: PRICE_SCALE_X, clientY: 250 });

        const published = surface.published.at(-1)!.viewport;
        expect(published.highPrice - published.lowPrice).toBeCloseTo(1_000, 6);
    });

    it('widens the time span when the time scale is dragged left', () => {
        const { surface } = buildHarness();

        surface.fire('pointerdown', { pointerId: 1, clientX: 400, clientY: TIME_SCALE_Y });
        surface.fire('pointermove', { pointerId: 1, clientX: 220, clientY: TIME_SCALE_Y });

        const published = surface.published.at(-1)!.viewport;
        expect(published.toMs - published.fromMs).toBeGreaterThan(900_000);
    });

    it('pins the right edge so the live edge survives a time rescale', () => {
        const { surface } = buildHarness();

        surface.fire('pointerdown', { pointerId: 1, clientX: 400, clientY: TIME_SCALE_Y });
        surface.fire('pointermove', { pointerId: 1, clientX: 220, clientY: TIME_SCALE_Y });

        expect(surface.published.at(-1)?.viewport.toMs).toBeCloseTo(VIEWPORT.toMs, 6);
    });

    it('does not drive the crosshair while an axis is being dragged', () => {
        const { surface } = buildHarness();

        surface.fire('pointerdown', { pointerId: 1, clientX: PRICE_SCALE_X, clientY: 250 });
        surface.fire('pointermove', { pointerId: 1, clientX: PRICE_SCALE_X, clientY: 430 });

        expect(surface.pointers).toEqual([]);
    });

    it('offers a resize cursor over the price scale', () => {
        const { surface } = buildHarness();

        surface.fire('pointermove', { pointerId: 7, clientX: PRICE_SCALE_X, clientY: 250 });

        expect(surface.surface.style.cursor).toBe('ns-resize');
    });

    it('offers the crosshair back over the plot', () => {
        const { surface } = buildHarness();

        surface.fire('pointermove', { pointerId: 7, clientX: 400, clientY: 250 });

        expect(surface.surface.style.cursor).toBe('crosshair');
    });
});

/** A 380x780 surface is compact: the price axis is 58px, the profile 52px. */
function buildPhoneHarness(): Harness {
    const surface = createGestureSurface(VIEWPORT, { width: 380, height: 780 });
    const controller = new ChartGestureController({
        surface: surface.surface,
        readViewport: surface.readViewport,
        readSurfaceSize: () => ({ width: surface.width, height: surface.height }),
        readLayout: () => resolveChartLayout({
            cssWidth: surface.width,
            cssHeight: surface.height,
            isVolumeProfileVisible: true,
        }),
        onView: (request) => surface.published.push(request),
        onPointerMove: (pointer) => surface.pointers.push(pointer),
    });
    controller.attach();
    return { controller, surface };
}

describe('ChartGestureController on a phone', () => {
    it('scales the price from the axis, which is still a thumb wide', () => {
        const { surface } = buildPhoneHarness();

        surface.fire('pointerdown', { pointerId: 1, clientX: 350, clientY: 300 });
        surface.fire('pointermove', { pointerId: 1, clientX: 350, clientY: 480 });

        const published = surface.published.at(-1)!.viewport;
        expect(published.highPrice - published.lowPrice).toBeGreaterThan(1_000);
    });

    it('leaves the profile pannable rather than spending it on a grip', () => {
        const { surface } = buildPhoneHarness();

        surface.fire('pointerdown', { pointerId: 1, clientX: 295, clientY: 300 });
        surface.fire('pointermove', { pointerId: 1, clientX: 295, clientY: 480 });

        const published = surface.published.at(-1)!.viewport;
        expect(published.highPrice - published.lowPrice).toBeCloseTo(1_000, 6);
    });

    it('pans from the bottom strip instead of rescaling time under the thumb', () => {
        const { surface } = buildPhoneHarness();

        surface.fire('pointerdown', { pointerId: 1, clientX: 150, clientY: 770 });
        surface.fire('pointermove', { pointerId: 1, clientX: 40, clientY: 770 });

        const published = surface.published.at(-1)!.viewport;
        expect(published.toMs - published.fromMs).toBeCloseTo(900_000, 6);
    });

    it('still pinches to scale both axes', () => {
        const { surface } = buildPhoneHarness();
        surface.fire('pointerdown', { pointerId: 1, clientX: 120, clientY: 300 });
        surface.fire('pointerdown', { pointerId: 2, clientX: 240, clientY: 300 });

        surface.fire('pointermove', { pointerId: 2, clientX: 340, clientY: 300 });

        const published = surface.published.at(-1)!.viewport;
        expect(published.toMs - published.fromMs).toBeLessThan(900_000);
    });
});

describe('ChartGestureController tracking', () => {
    /** Where the plot ends, which is short of the surface whenever chrome shows. */
    function plotWidthOf(surface: GestureSurfaceMock): number {
        return resolveChartLayout({
            cssWidth: surface.width,
            cssHeight: surface.height,
            isVolumeProfileVisible: true,
        }).plotWidth;
    }

    it('moves the chart exactly as far as the finger, not as far as the surface', () => {
        // The projector maps time across the plot, not across the container. A
        // gesture measured against the container makes the content lag the
        // finger by the width of the profile and the price axis — about a fifth.
        const { surface } = buildHarness();
        const spanMs = VIEWPORT.toMs - VIEWPORT.fromMs;

        dragBy(surface, 100, 0);

        const moved = VIEWPORT.fromMs - (surface.published.at(-1)?.viewport.fromMs ?? 0);
        expect(moved).toBeCloseTo((100 / plotWidthOf(surface)) * spanMs, 6);
    });

    it('moves the chart vertically as far as the finger', () => {
        const { surface } = buildHarness();
        const priceSpan = VIEWPORT.highPrice - VIEWPORT.lowPrice;
        const pricePaneHeight = resolveChartLayout({
            cssWidth: surface.width,
            cssHeight: surface.height,
            isVolumeProfileVisible: true,
        }).pricePaneHeight;

        dragBy(surface, 0, 50);

        const moved = (surface.published.at(-1)?.viewport.lowPrice ?? 0) - VIEWPORT.lowPrice;
        expect(moved).toBeCloseTo((50 / pricePaneHeight) * priceSpan, 6);
    });

    it('keeps the instant under the wheel where it was', () => {
        // Zoom anchors on a ratio of the plot; measuring that ratio against the
        // container puts the anchor to the right of the cursor and the chart
        // slides under it as it scales.
        const { surface } = buildHarness();
        const plotWidth = plotWidthOf(surface);
        const anchorX = 200;
        const before = VIEWPORT.fromMs + (anchorX / plotWidth) * (VIEWPORT.toMs - VIEWPORT.fromMs);

        surface.fire('wheel', { clientX: anchorX, clientY: 250, deltaY: -100 });

        const zoomed = surface.published.at(-1)!.viewport;
        const after = zoomed.fromMs + (anchorX / plotWidth) * (zoomed.toMs - zoomed.fromMs);
        expect(after).toBeCloseTo(before, 6);
    });
});
