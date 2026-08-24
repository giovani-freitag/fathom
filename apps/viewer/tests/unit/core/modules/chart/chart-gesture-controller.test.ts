import type { ChartViewport } from '@core/domain/chart-viewport';
import { ChartGestureController } from '@core/modules/chart/chart-gesture-controller';
import { describe, expect, it } from 'vitest';
import { createGestureSurface, type GestureSurfaceMock } from '../../../../mocks/gesture-surface.ts';

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
