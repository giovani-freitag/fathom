import { forgetConnector, registerConnector } from '../../../../../src/app/venues/venue-registry.ts';
import { FIRST_VENUE } from '../../../../../src/shared/core/recording-control.ts';
import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { createIndicatorKernel, renderWithKernel } from '../../../../mocks/indicator-kernel.tsx';
import { IndicatorPalette } from '../../../../../src/app/ui/indicators/indicator-palette.tsx';

function renderPalette(options: {
    isFull?: boolean;
    counts?: [string, number][];
    venue?: string;
} = {}): {
    added: string[];
    container: HTMLElement;
} {
    const added: string[] = [];
    const kernel = createIndicatorKernel();

    const { container } = renderWithKernel(kernel, (
        <IndicatorPalette
            onAdd={(indicatorId) => { added.push(indicatorId); }}
            venue={options.venue ?? FIRST_VENUE}
            isFull={options.isFull ?? false}
            addedCounts={new Map(options.counts ?? [])}
        />
    ));

    return { added, container };
}

afterEach(() => { forgetConnector('sideless'); });

describe('IndicatorPalette', () => {
    it('separates what draws over the price from what needs a band of its own', () => {
        // The division a reader makes when choosing, because it decides whether
        // adding the thing reshapes the screen.
        renderPalette();

        expect(screen.getByRole('heading', { name: 'Over the price' })).toBeDefined();
        expect(screen.getByRole('heading', { name: 'In its own band' })).toBeDefined();
    });

    it('finds an indicator by what it does, not only by its name', () => {
        renderPalette();

        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'overbought' } });

        expect(screen.queryByRole('button', { name: /RSI/ })).toBeNull();
        expect(screen.getByText('Nothing by that name')).toBeDefined();
    });

    it('narrows to what the reader typed', () => {
        renderPalette();

        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'channel' } });

        expect(screen.getByRole('button', { name: /Bollinger/ })).toBeDefined();
        expect(screen.queryByRole('button', { name: /^RSI/ })).toBeNull();
    });

    it('takes the first match on return, so the keyboard is not a dead end', () => {
        const palette = renderPalette();
        const search = screen.getByRole('searchbox');

        fireEvent.change(search, { target: { value: 'macd' } });
        fireEvent.keyDown(search, { key: 'Enter' });

        expect(palette.added).toEqual(['macd']);
    });

    it('says how many copies the chart is already holding', () => {
        renderPalette({ counts: [['sma', 2]] });

        expect(screen.getByText('2')).toBeDefined();
    });

    it('offers nothing more once the chart is holding all it can draw', () => {
        const palette = renderPalette({ isFull: true });

        fireEvent.click(screen.getByRole('button', { name: /Bollinger/ }));

        expect(palette.added).toEqual([]);
        expect(screen.getByText('The chart is holding as many as it can draw')).toBeDefined();
    });
});

describe('IndicatorPalette leaving the scrolling to the panel it opens in', () => {
    it('gives no part of itself a scroller of its own', () => {
        const { container } = renderPalette();
        const scrollers = [...container.querySelectorAll('[class*="overflow-y"]')];

        expect(scrollers).toEqual([]);
    });

    it('holds the search field at the top instead, so it survives the scroll', () => {
        renderPalette();

        const field = screen.getByRole('searchbox').closest('[class*="sticky"]');

        expect(field).not.toBeNull();
    });
});

describe('what the venue cannot answer', () => {
    it('is offered but cannot be added, with the reason in place of the description', () => {
        // A delta of nought on a venue that publishes no sides is a claim that
        // buying and selling were even, and it reads exactly like the truth.
        registerConnector('sideless', {
            book: { grade: 'stepped', levelsPerSide: 50, publishIntervalMs: 100, clock: 'venue' },
            tape: { siding: 'unsided', clock: 'venue', hasStableIds: true },
            bars: null,
        });

        renderPalette({ venue: 'sideless' });

        const delta = screen.getByRole('button', { name: /^Delta/ });
        expect(delta.hasAttribute('disabled')).toBe(true);
        expect(delta.textContent).toContain('volume split by the side that crossed');
    });

    it('leaves within reach whatever the venue does answer', () => {
        registerConnector('sideless', {
            book: { grade: 'stepped', levelsPerSide: 50, publishIntervalMs: 100, clock: 'venue' },
            tape: { siding: 'unsided', clock: 'venue', hasStableIds: true },
            bars: null,
        });

        renderPalette({ venue: 'sideless' });

        expect(screen.getByRole('button', { name: /Money flow/ }).hasAttribute('disabled')).toBe(false);
    });

    it('offers everything on the venue the build ships against', () => {
        renderPalette();

        expect(screen.getByRole('button', { name: /^Delta/ }).hasAttribute('disabled')).toBe(false);
    });
});
