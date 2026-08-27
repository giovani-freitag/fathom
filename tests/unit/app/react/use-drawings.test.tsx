import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import type { Drawing } from '../../../../src/shared/core/drawing.ts';
import { DEFAULT_PREFERENCES, type PreferencesService } from '../../../../src/app/services/preferences-service.ts';
import { DrawingsController } from '../../../../src/app/drawings/drawings-controller.ts';
import { KernelProvider } from '../../../../src/app/react/kernel-provider.tsx';
import type { ServiceContainer } from '../../../../src/app/core/service-container.ts';
import { useDrawings } from '../../../../src/app/react/use-drawings.ts';

const LEVEL: Drawing = {
    id: 'level',
    kind: 'horizontal-line',
    instrumentSymbol: 'BTCUSDT',
    anchors: [{ atMs: 1_000, price: 100 }],
    tone: 'phosphor',
};

/** Mounts something that only exists to run the hook. */
function ReadDrawings(): null {
    useDrawings();
    return null;
}

describe('useDrawings and the keys a reader reaches for', () => {
    let drawings: DrawingsController;

    beforeEach(() => {
        drawings = new DrawingsController({
            preferences: {
                read: () => ({ ...DEFAULT_PREFERENCES, drawings: [LEVEL] }),
                write: vi.fn(),
            } as unknown as PreferencesService,
            readInstrumentSymbol: () => 'BTCUSDT',
            newId: () => 'made',
        });

        render(
            <KernelProvider container={{ drawings } as unknown as ServiceContainer}>
                <ReadDrawings />
            </KernelProvider>,
        );
    });

    /** A key press on the page, as a reader would make it. */
    function press(key: string, target: EventTarget = window): void {
        act(() => {
            target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
        });
    }

    it('takes the selected mark off the chart on Delete', () => {
        act(() => { drawings.select('level'); });

        press('Delete');

        expect(drawings.store.read().drawings).toEqual([]);
    });

    it('answers Backspace the same way, because readers try both', () => {
        act(() => { drawings.select('level'); });

        press('Backspace');

        expect(drawings.store.read().drawings).toEqual([]);
    });

    it('removes nothing while nothing is selected', () => {
        press('Delete');

        expect(drawings.store.read().drawings).toEqual([LEVEL]);
    });

    it('puts the armed tool down on Escape', () => {
        act(() => { drawings.arm('trend-line'); });

        press('Escape');

        expect(drawings.store.read().armedTool).toBeNull();
    });

    it('lets go of the selection on Escape too', () => {
        act(() => { drawings.select('level'); });

        press('Escape');

        expect(drawings.store.read().selectedId).toBeNull();
    });

    it('keeps its hands off a reader who is typing', () => {
        // A symbol typed into a field would otherwise delete a mark the reader
        // never meant to touch.
        act(() => { drawings.select('level'); });
        const field = document.createElement('input');
        document.body.append(field);

        press('Delete', field);

        expect(drawings.store.read().drawings).toEqual([LEVEL]);
    });
});
