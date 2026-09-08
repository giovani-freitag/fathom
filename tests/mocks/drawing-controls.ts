import { vi } from 'vitest';
import type { DrawingControls } from '../../src/app/react/use-drawings.ts';

/**
 * The drawing controls as a double, with every action a spy.
 *
 * A factory rather than a shared object so no test inherits another's calls,
 * and complete rather than cast, so a control added to the contract fails here
 * instead of reaching a component that quietly renders without it.
 *
 * @param overrides - Whatever this test needs to be true of the controls.
 * @returns A fresh set of controls, resting and armed with nothing.
 */
export function createDrawingControls(overrides: Partial<DrawingControls> = {}): DrawingControls {
    return {
        armedTool: null,
        isToolLocked: false,
        toggleToolLock: vi.fn(),
        selectedId: null,
        selected: null,
        pending: { tone: null, width: 'medium', style: 'solid', glyph: '\u{1F440}' },
        recentGlyphs: [],
        toggleTool: vi.fn(),
        disarm: vi.fn(),
        restyleSelected: vi.fn(),
        restylePending: vi.fn(),
        removeSelected: vi.fn(),
        canUndo: false,
        canRedo: false,
        undo: vi.fn(),
        redo: vi.fn(),
        ...overrides,
    };
}
