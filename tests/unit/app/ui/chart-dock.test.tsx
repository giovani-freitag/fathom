import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChartDock, type ChartDockProps } from '../../../../src/app/ui/chart-dock.tsx';
import type { DrawingControls } from '../../../../src/app/react/use-drawings.ts';
import type { IndicatorControls } from '../../../../src/app/react/use-indicators.ts';
import { EN_DICTIONARY } from '../../../../src/app/i18n/dictionaries/en.ts';
import { createIndicatorKernel } from '../../../mocks/indicator-kernel.tsx';
import type { DrawingRestyle } from '../../../../src/app/drawings/drawings-controller.ts';
import { KernelProvider } from '../../../../src/app/react/kernel-provider.tsx';

interface Pressed {
    readonly armed: (string | null)[];
    readonly disarmed: number[];
    readonly restyled: DrawingRestyle[];
    readonly removed: number[];
    readonly undone: number[];
    readonly redone: number[];
}

function buildControls(overrides: Partial<DrawingControls>, pressed: Pressed): DrawingControls {
    return {
        armedTool: null,
        isToolLocked: false,
        toggleToolLock: () => undefined,
        selectedId: null,
        selected: null,
        canUndo: false,
        canRedo: false,
        toggleTool: (kind) => { pressed.armed.push(kind); },
        disarm: () => { pressed.disarmed.push(1); },
        restyleSelected: (look) => { pressed.restyled.push(look); },
        removeSelected: () => { pressed.removed.push(1); },
        undo: () => { pressed.undone.push(1); },
        redo: () => { pressed.redone.push(1); },
        ...overrides,
    };
}

const INSTRUMENT = {
    instrumentSymbol: 'BTCUSDT',
    priceBucketSize: 10,
    frameIntervalMs: 1_000,
    firstFrameAtMs: 1_000,
    lastFrameAtMs: 2_000,
    lastMidPrice: 79_000,
};

function renderDock(overrides: Partial<DrawingControls> = {}): Pressed {
    const pressed: Pressed = {
        armed: [], disarmed: [], restyled: [], removed: [], undone: [], redone: [],
    };
    const kernel = createIndicatorKernel([]);
    const controls = buildControls(overrides, pressed);

    const props: ChartDockProps = {
        drawings: controls,
        indicators: {
            added: [],
            addedCounts: new Map<string, number>(),
            isFull: false,
            add: () => undefined,
            remove: () => undefined,
            update: () => undefined,
            reorder: () => undefined,
            undoRemoval: () => undefined,
            dismissRemoval: () => undefined,
            removed: null,
        } as unknown as IndicatorControls,
        instruments: [INSTRUMENT],
        instrumentSymbol: 'BTCUSDT',
        onInstrumentSelect: () => undefined,
        time: {
            visibleSpanMs: 900_000,
            onSpanSelect: () => undefined,
            barIntervalMs: null,
            effectiveIntervalMs: 5_000,
            onIntervalSelect: () => undefined,
        },
    };

    render(
        <KernelProvider container={kernel.container}>
            <ChartDock {...props} />
        </KernelProvider>,
    );

    return pressed;
}

/** One control of the dock, by the words it is announced with. */
function control(labelKey: keyof typeof EN_DICTIONARY): HTMLButtonElement {
    return screen.getByRole<HTMLButtonElement>('button', { name: EN_DICTIONARY[labelKey] });
}

describe('ChartDock', () => {
    it('carries the questions that used to sit in a header', () => {
        renderDock();

        expect([
            control('instrument.label'),
            control('dock.time'),
            control('indicators.onTheChart'),
        ]).toHaveLength(3);
    });

    it('names the contract by its base asset, which is how a reader reads it', () => {
        // The quote is the same on every contract offered, so it is the half
        // that carries nothing.
        renderDock();

        expect(control('instrument.label').textContent).toContain('BTC');
    });

    it('carries a way into what is already on the chart', () => {
        renderDock();

        expect(control('indicators.onTheChart')).toBeTruthy();
    });

    it('says how much time is on screen without being opened', () => {
        renderDock();

        expect(control('dock.time').textContent).toContain('15');
    });

    it('offers a tool for every kind of mark the build draws', () => {
        renderDock();

        expect([
            control('drawing.horizontalLine'),
            control('drawing.trendLine'),
            control('drawing.zone'),
        ]).toHaveLength(3);
    });

    it('shows the pointer as the tool in force while none is armed', () => {
        // Nothing highlighted reads as a broken control rather than as a chart
        // that pans, so the resting state is a tool of its own.
        renderDock();

        expect(control('drawing.select').getAttribute('aria-pressed')).toBe('true');
    });

    it('arms the tool that was pressed', () => {
        const pressed = renderDock();

        control('drawing.zone').click();

        expect(pressed.armed).toEqual(['zone']);
    });

    it('puts every tool down when the pointer is pressed', () => {
        const pressed = renderDock({ armedTool: 'zone' });

        control('drawing.select').click();

        expect(pressed.disarmed).toEqual([1]);
    });

    it('names itself, so a reader arriving by keyboard knows what it is', () => {
        renderDock();

        expect(screen.getByRole('toolbar', { name: EN_DICTIONARY['dock.label'] })).toBeTruthy();
    });

    it('keeps stepping back beside the tools it steps back over', () => {
        const pressed = renderDock({ canUndo: true });

        control('drawing.undo').click();

        expect(pressed.undone).toEqual([1]);
    });

    it('offers no step forward until one was taken back', () => {
        renderDock({ canUndo: true });

        expect(control('drawing.redo').disabled).toBe(true);
    });
});

describe('ChartDock centred', () => {
    it('holds its controls in a box of its own, so they can sit in the middle', () => {
        // Centred by an inner box with margins rather than by justifying the
        // scroller: a centred scroller puts its overflow past the left edge,
        // where nothing can scroll back to it.
        renderDock();

        const inner = screen.getByRole('toolbar').firstElementChild;

        expect(inner?.className).toContain('m-auto');
    });
});

describe('ChartDock and the catalogue', () => {
    it('answers no keyboard chord of its own', () => {
        // A catalogue of indicators is too particular a thing to hold a chord
        // every reader's fingers have other uses for.
        renderDock();

        fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

        expect(screen.queryByRole('searchbox')).toBeNull();
    });

    it('offers one way in, which is the panel the layers are already in', () => {
        renderDock();

        expect(screen.queryByRole('button', { name: EN_DICTIONARY['indicators.open'] })).toBeNull();
    });
});
