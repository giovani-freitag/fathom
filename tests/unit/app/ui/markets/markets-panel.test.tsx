import { afterEach, describe, expect, it } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { createIndicatorKernel, renderWithKernel } from '../../../../mocks/indicator-kernel.tsx';
import { FAVOURITES_ID, type MarketPair } from '../../../../../src/shared/core/pair-tags.ts';
import { FIRST_VENUE } from '../../../../../src/shared/core/recording-control.ts';
import { MarketsPanel } from '../../../../../src/app/ui/markets/markets-panel.tsx';
import { buildConnector } from '../../../../mocks/venue-connectors.ts';
import { forgetConnector, registerConnector } from '../../../../../src/shared/venues/venue-registry.ts';

afterEach(() => { forgetConnector('empty'); });

let lastKernel: ReturnType<typeof createIndicatorKernel> | null = null;

function renderPanel(): { opened: MarketPair[] } {
    const opened: MarketPair[] = [];
    const kernel = createIndicatorKernel();
    lastKernel = kernel;
    kernel.setState((state) => ({
        ...state,
        instrumentSymbol: 'BTCUSDT',
        instruments: [{
            instrumentSymbol: 'BTCUSDT',
            venue: FIRST_VENUE,
            priceBucketSize: 10,
            frameIntervalMs: 1_000,
            firstFrameAtMs: 1_000,
            lastFrameAtMs: 2_000,
            lastMidPrice: 79_000,
        }],
    }));

    renderWithKernel(kernel, (
        <MarketsPanel
            open={null}
            onClose={() => undefined}
            onOpen={(pair: MarketPair) => { opened.push(pair); }}
        />
    ));
    return { opened };
}

/** Points the listing at the shipped venue and waits for it to answer. */
async function browse(venue = FIRST_VENUE): Promise<void> {
    fireEvent.click(screen.getByRole('button', { name: venue }));
    await waitFor(() => {
        expect(screen.getByRole('button', { name: /File BTCUSDT under/ })).toBeDefined();
    });
}

/**
 * One tag's row in the rail.
 *
 * By a name that begins with the tag's own, because the marking buttons and the
 * delete button all carry that name somewhere in theirs too.
 */
function railRow(name: string): HTMLElement {
    return screen.getByRole('button', { name: new RegExp(`^${name}`) });
}

/** Makes a tag and leaves it open, the way a reader would. */
function makeTag(name: string): void {
    fireEvent.click(screen.getByRole('button', { name: 'New tag' }));
    fireEvent.change(screen.getByLabelText('Name this tag'), { target: { value: name } });
    fireEvent.keyDown(screen.getByLabelText('Name this tag'), { key: 'Enter' });
}

describe('the card a reader picks a contract on', () => {
    it('opens on the tag every reader starts with', () => {
        renderPanel();

        expect(railRow('Favourites').getAttribute('aria-current')).toBe('true');
    });

    it('says the tag is empty rather than showing a blank stretch', () => {
        renderPanel();

        expect(screen.getByText(/Nothing under this tag yet/)).toBeDefined();
    });

    it('offers every venue and every tag from the one rail', () => {
        renderPanel();

        expect(screen.getByRole('button', { name: FIRST_VENUE })).toBeDefined();
        expect(railRow('Favourites')).toBeDefined();
    });

    it('asks the venue what it trades the moment one is picked', async () => {
        renderPanel();

        await browse();

        expect(screen.getByRole('button', { name: /File NANOUSDT under/ })).toBeDefined();
    });
});

describe('narrowing a venue listing', () => {
    it('searches by asset as well as by symbol', async () => {
        renderPanel();
        await browse();

        fireEvent.change(screen.getByLabelText('Search pairs'), { target: { value: 'NANO' } });

        expect(screen.queryByRole('button', { name: /File BTCUSDT under/ })).toBeNull();
        expect(screen.getByRole('button', { name: /File NANOUSDT under/ })).toBeDefined();
    });

    it('offers the venue\'s own quote currencies as chips', async () => {
        renderPanel();
        await browse();

        expect(screen.getByRole('button', { name: 'USDT' }).getAttribute('aria-pressed')).toBe('false');
        expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true');
    });

    it('narrows to a quote when its chip is pressed', async () => {
        renderPanel();
        await browse();

        fireEvent.click(screen.getByRole('button', { name: 'USDT' }));

        expect(screen.getByRole('button', { name: 'USDT' }).getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByRole('button', { name: /File BTCUSDT under/ })).toBeDefined();
    });
});

describe('keeping a pair', () => {
    it('files it under the open tag', async () => {
        renderPanel();
        await browse();

        fireEvent.click(screen.getByRole('button', { name: /File BTCUSDT under Favourites/ }));

        expect(screen.getByRole('button', { name: /Take BTCUSDT out of Favourites/ })).toBeDefined();
    });

    it('goes under the tag the reader has open rather than always the first', async () => {
        renderPanel();
        makeTag('Shitcoins');
        await browse();

        fireEvent.click(screen.getByRole('button', { name: /File NANOUSDT under Shitcoins/ }));

        expect(railRow('Shitcoins').textContent).toContain('1');
    });

    it('says which tag the next press files under, even while browsing a venue', async () => {
        // A reader who has walked away from their tags to a venue cannot see
        // which one is selected without being told.
        renderPanel();
        makeTag('Shitcoins');
        await browse();

        expect(screen.getByText(/Filing under Shitcoins/)).toBeDefined();
    });

    it('marks a pair with every other tag it carries, not only the open one', async () => {
        // The whole of what a tag gives a list: one pair under two of them, and
        // a reader who can see the second without opening it.
        renderPanel();
        makeTag('Shitcoins');
        await browse();
        fireEvent.click(screen.getByRole('button', { name: /File BTCUSDT under Shitcoins/ }));
        fireEvent.click(railRow('Favourites'));
        await browse();

        const row = screen.getByRole('button', { name: /Open BTCUSDT on the chart/ });
        expect(row.querySelectorAll('span.rounded-full')).toHaveLength(1);
    });

    it('opens the tag it has just made, because that is where the next press files', () => {
        renderPanel();

        makeTag('Shitcoins');

        expect(railRow('Shitcoins').getAttribute('aria-current')).toBe('true');
    });
});

describe('what each half marks', () => {
    it('marks the handful a venue lists that this chart actually holds', async () => {
        // The reason nothing else opens is true of nine hundred rows, and a
        // column that repeats it nine hundred times says nothing.
        renderPanel();
        await browse();

        const held = screen.getByRole('button', { name: /Open BTCUSDT on the chart/ });
        expect(held.textContent).toContain('recorded');
        expect(screen.getByRole('button', { name: /^NANOUSDT/ }).textContent)
            .not.toContain('Nothing recorded');
    });

    it('says why under a tag, where a reader kept the pair themselves', async () => {
        renderPanel();
        await browse();
        fireEvent.click(screen.getByRole('button', { name: /File NANOUSDT under Favourites/ }));
        fireEvent.click(railRow('Favourites'));

        // Two words in the row, the whole sentence on the row's own label: one
        // long note held at its own width gave the listing a sideways scroll.
        const row = screen.getByRole('button', { name: /NANOUSDT — Nothing recorded here yet/ });
        expect(row.textContent).toContain('not recorded');
        expect(row.textContent).not.toContain('Nothing recorded here yet');
    });
});

describe('opening what is kept', () => {
    it('hands back the venue as well as the symbol', async () => {
        const { opened } = renderPanel();
        await browse();
        fireEvent.click(screen.getByRole('button', { name: /File BTCUSDT under Favourites/ }));
        fireEvent.click(railRow('Favourites'));

        fireEvent.click(screen.getByRole('button', { name: /Open BTCUSDT on the chart/ }));

        expect(opened[0]).toEqual({ venue: FIRST_VENUE, symbol: 'BTCUSDT' });
    });

    it('will not open a pair nothing has recorded, and says why', async () => {
        const { opened } = renderPanel();
        await browse();
        fireEvent.click(screen.getByRole('button', { name: /File NANOUSDT under Favourites/ }));
        fireEvent.click(railRow('Favourites'));

        const kept = screen.getByRole('button', { name: /NANOUSDT — Nothing recorded here yet/ });
        fireEvent.click(kept);

        expect(kept.hasAttribute('disabled')).toBe(true);
        expect(opened).toEqual([]);
    });

    it('says the venue draws nothing, where its connector declared nothing', () => {
        // Two different answers on purpose: a reader who reads the first one for
        // the second goes looking for a broken recording instead of for the
        // `null` their own connector declared.
        registerConnector('empty', buildConnector({ book: null, tape: null, bars: null }));
        renderPanel();

        act(() => {
            lastKernel!.container.markets.tagPair(FAVOURITES_ID, { venue: 'empty', symbol: 'FOO-BAR' });
        });

        expect(screen.getByRole('button', { name: /FOO-BAR — This venue declares no book/ })).toBeDefined();
    });
});
