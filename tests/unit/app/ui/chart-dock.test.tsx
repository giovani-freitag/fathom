import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChartDock, type ChartDockProps } from '../../../../src/app/ui/chart-dock.tsx';
import { DrawingActions } from '../../../../src/app/ui/drawing-actions.tsx';
import type { DrawingControls } from '../../../../src/app/react/use-drawings.ts';
import type { IndicatorControls } from '../../../../src/app/react/use-indicators.ts';
import { EN_DICTIONARY } from '../../../../src/app/i18n/dictionaries/en.ts';
import { createIndicatorKernel } from '../../../mocks/indicator-kernel.tsx';
import { INSTANCE_TONES, type PlotTone } from '../../../../src/shared/core/draw-plan.ts';
import { KernelProvider } from '../../../../src/app/react/kernel-provider.tsx';

interface Pressed {
    readonly armed: (string | null)[];
    readonly disarmed: number[];
    readonly recoloured: PlotTone[];
    readonly removed: number[];
    readonly undone: number[];
    readonly redone: number[];
}

function buildControls(overrides: Partial<DrawingControls>, pressed: Pressed): DrawingControls {
    return {
        armedTool: null,
        selectedId: null,
        selectedTone: null,
        canUndo: false,
        canRedo: false,
        toggleTool: (kind) => { pressed.armed.push(kind); },
        disarm: () => { pressed.disarmed.push(1); },
        recolourSelected: (tone) => { pressed.recoloured.push(tone); },
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
};

function renderDock(overrides: Partial<DrawingControls> = {}): Pressed {
    const pressed: Pressed = {
        armed: [], disarmed: [], recoloured: [], removed: [], undone: [], redone: [],
    };
    const kernel = createIndicatorKernel([]);
    const controls = buildControls(overrides, pressed);

    const props: ChartDockProps = {
        drawings: controls,
        indicators: {
            addedIndicators: [],
            addedCounts: {},
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
            recordedSpanMs: 86_400_000,
            onSpanSelect: () => undefined,
            barIntervalMs: null,
            effectiveIntervalMs: 5_000,
            frameIntervalMs: 1_000,
            onIntervalSelect: () => undefined,
        },
    };

    render(
        <KernelProvider container={kernel.container}>
            <DrawingActions controls={controls} />
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
            control('indicators.open'),
        ]).toHaveLength(3);
    });

    it('names the contract by its base asset, which is how a reader reads it', () => {
        // The quote is the same on every contract offered, so it is the half
        // that carries nothing.
        renderDock();

        expect(control('instrument.label').textContent).toBe('BTC');
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
});

describe('DrawingActions', () => {
    it('stays off a chart nothing has happened to', () => {
        // Most readers never draw. A row of controls that could do nothing is a
        // row of chart they lost for the whole session.
        renderDock();

        expect(screen.queryByRole('group', { name: EN_DICTIONARY['drawing.actions'] })).toBeNull();
    });

    it('appears once there is a step to take back', () => {
        renderDock({ canUndo: true });

        expect(screen.getByRole('group', { name: EN_DICTIONARY['drawing.actions'] })).toBeTruthy();
    });

    it('steps back when asked', () => {
        const pressed = renderDock({ canUndo: true });

        control('drawing.undo').click();

        expect(pressed.undone).toEqual([1]);
    });

    it('offers no step forward until one was taken back', () => {
        renderDock({ canUndo: true });

        expect(control('drawing.redo').disabled).toBe(true);
    });

    it('steps forward when asked', () => {
        const pressed = renderDock({ canUndo: true, canRedo: true });

        control('drawing.redo').click();

        expect(pressed.redone).toEqual([1]);
    });

    it('offers no removal while nothing is selected', () => {
        renderDock({ canUndo: true });

        expect(control('drawing.remove').disabled).toBe(true);
    });

    it('removes the mark that is selected', () => {
        const pressed = renderDock({ selectedId: 'level' });

        control('drawing.remove').click();

        expect(pressed.removed).toEqual([1]);
    });

    it('offers no colours while there is nothing to colour', () => {
        renderDock({ canUndo: true });

        expect(screen.queryByRole('button', { name: 'amber' })).toBeNull();
    });

    it('offers every tone once a mark is selected', () => {
        renderDock({ selectedId: 'level', selectedTone: 'phosphor' });

        const swatches = INSTANCE_TONES
            .map((tone) => screen.queryByRole('button', { name: tone }))
            .filter((found) => found !== null);
        expect(swatches).toHaveLength(INSTANCE_TONES.length);
    });

    it('paints the selected mark in the tone that was pressed', () => {
        const pressed = renderDock({ selectedId: 'level', selectedTone: 'phosphor' });

        screen.getByRole('button', { name: 'amber' }).click();

        expect(pressed.recoloured).toEqual(['amber']);
    });

    it('shows which tone the selected mark already carries', () => {
        renderDock({ selectedId: 'level', selectedTone: 'cyan' });

        expect(screen.getByRole('button', { name: 'cyan' }).getAttribute('aria-pressed')).toBe('true');
    });
});
