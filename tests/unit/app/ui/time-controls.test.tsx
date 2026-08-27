import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BarIntervalControl, SpanControl } from '../../../../src/app/ui/time-controls.tsx';
import { createIndicatorKernel } from '../../../mocks/indicator-kernel.tsx';
import { EN_DICTIONARY } from '../../../../src/app/i18n/dictionaries/en.ts';
import { KernelProvider } from '../../../../src/app/react/kernel-provider.tsx';
import { SPAN_PRESETS } from '../../../../src/app/ui/span-preset-catalogue.ts';

const HOUR_MS = 3_600_000;
const WEEK_MS = 604_800_000;

interface Chosen {
    readonly spans: number[];
    readonly intervals: (number | null)[];
}

function renderSpans(options: { isCollapsed?: boolean } = {}): Chosen {
    const chosen: Chosen = { spans: [], intervals: [] };
    const kernel = createIndicatorKernel();

    render(
        <KernelProvider container={kernel.container}>
            <SpanControl
                activeSpanMs={HOUR_MS}
                isCollapsed={options.isCollapsed ?? false}
                onSelect={(spanMs) => { chosen.spans.push(spanMs); }}
            />
        </KernelProvider>,
    );

    return chosen;
}

function renderIntervals(): Chosen {
    const chosen: Chosen = { spans: [], intervals: [] };
    const kernel = createIndicatorKernel();

    render(
        <KernelProvider container={kernel.container}>
            <BarIntervalControl
                barIntervalMs={null}
                effectiveIntervalMs={60_000}
                onSelect={(intervalMs) => { chosen.intervals.push(intervalMs); }}
            />
        </KernelProvider>,
    );

    return chosen;
}

describe('SpanControl laid out', () => {
    it('offers every span the chart knows', () => {
        renderSpans();

        expect(screen.getAllByRole('radio')).toHaveLength(SPAN_PRESETS.length);
    });

    it('marks the one the window is showing', () => {
        renderSpans();

        expect(screen.getByRole('radio', { name: EN_DICTIONARY['span.1h'] })
            .getAttribute('aria-checked')).toBe('true');
    });

    it('still marks it after the reader has nudged the view', () => {
        // A reader who pressed an hour and then panned is still looking at an
        // hour, and a row that let go at the first drag would say nothing.
        const kernel = createIndicatorKernel();
        render(
            <KernelProvider container={kernel.container}>
                <SpanControl activeSpanMs={HOUR_MS * 1.05} onSelect={() => undefined} />
            </KernelProvider>,
        );

        expect(screen.getByRole('radio', { name: EN_DICTIONARY['span.1h'] })
            .getAttribute('aria-checked')).toBe('true');
    });

    it('jumps the window to the span that was pressed', () => {
        const chosen = renderSpans();

        screen.getByRole('radio', { name: EN_DICTIONARY['span.1d'] }).click();

        expect(chosen.spans).toEqual([86_400_000]);
    });

    it('offers a week to a reader who has recorded an hour', () => {
        // The spans were gated on the recording when the price was drawn from
        // it too. The price is fetched now: a week is a week whatever this
        // chart has of the book, and what it has of the book is drawn as the
        // book, which is where that belongs.
        const chosen = renderSpans();

        screen.getByRole('radio', { name: EN_DICTIONARY['span.1w'] }).click();

        expect(chosen.spans).toEqual([WEEK_MS]);
    });
});

describe('SpanControl folded into a menu', () => {
    it('asks the same question behind one control', () => {
        renderSpans({ isCollapsed: true });

        expect(screen.getByRole('combobox', { name: EN_DICTIONARY['span.label'] })).toBeTruthy();
    });

    it('says which span the window is showing without being opened', () => {
        renderSpans({ isCollapsed: true });

        expect(screen.getByRole('combobox', { name: EN_DICTIONARY['span.label'] }).textContent)
            .toContain(EN_DICTIONARY['span.1h']);
    });

    it('lays the choices out rather than folding them where there is room', () => {
        renderSpans({ isCollapsed: false });

        expect(screen.queryByRole('combobox')).toBeNull();
    });
});

describe('BarIntervalControl', () => {
    it('offers the window the chance to decide for itself', () => {
        renderIntervals();

        expect(screen.getByRole('radio', { name: 'Auto · 1min' })).toBeTruthy();
    });

    it('offers only rungs the venue publishes a candle for', () => {
        // Every rung on the ladder is one; a width no venue serves would be a
        // choice that answers with nothing.
        renderIntervals();

        expect(screen.queryByRole('radio', { name: '1s' })).toBeNull();
    });

    it('hands the decision back when the automatic choice is pressed', () => {
        const chosen = renderIntervals();

        screen.getAllByRole('radio')[0]!.click();

        expect(chosen.intervals).toEqual([null]);
    });
});
