import type { ChartViewport } from '../../src/app/core/chart-viewport.ts';
import type { ViewRequest } from '../../src/app/core/chart-controller.ts';
import { vi } from 'vitest';

export interface GestureSurfaceMock {
    readonly surface: HTMLElement;
    readonly width: number;
    readonly height: number;
    readonly published: ViewRequest[];
    readonly pointers: (({ x: number; y: number }) | null)[];
    readonly readViewport: () => ChartViewport;
    fire: (type: string, event: Record<string, unknown>) => void;
    listenerCount: () => number;
}

/**
 * A surface that records the handlers registered on it and lets a test invoke
 * them directly.
 *
 * Driving real DOM events would test jsdom's pointer emulation rather than the
 * gesture arithmetic, which is the part that decides how the chart feels.
 */
export function createGestureSurface(viewport: ChartViewport): GestureSurfaceMock {
    const handlers = new Map<string, ((event: unknown) => void)[]>();
    const published: ViewRequest[] = [];
    const pointers: (({ x: number; y: number }) | null)[] = [];

    const surface = {
        addEventListener: (type: string, handler: (event: unknown) => void) => {
            handlers.set(type, [...(handlers.get(type) ?? []), handler]);
        },
        removeEventListener: (type: string, handler: (event: unknown) => void) => {
            handlers.set(type, (handlers.get(type) ?? []).filter((candidate) => candidate !== handler));
        },
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 1_000, height: 500 }),
        setPointerCapture: vi.fn(),
        hasPointerCapture: () => true,
        releasePointerCapture: vi.fn(),
    } as unknown as HTMLElement;

    return {
        surface,
        width: 1_000,
        height: 500,
        published,
        pointers,
        readViewport: () => viewport,
        fire: (type, event) => {
            for (const handler of handlers.get(type) ?? []) {
                handler({ preventDefault: () => undefined, ...event });
            }
        },
        listenerCount: () => [...handlers.values()].reduce((running, list) => running + list.length, 0),
    };
}
