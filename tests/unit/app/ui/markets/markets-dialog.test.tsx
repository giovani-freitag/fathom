import { afterEach, describe, expect, it } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { createIndicatorKernel, renderWithKernel } from '../../../../mocks/indicator-kernel.tsx';
import { FAVOURITES_ID, type WatchedPair } from '../../../../../src/shared/core/watch-lists.ts';
import { FIRST_VENUE } from '../../../../../src/shared/core/recording-control.ts';
import { MarketsDialog } from '../../../../../src/app/ui/markets/markets-dialog.tsx';
import { buildConnector } from '../../../../mocks/venue-connectors.ts';
import { forgetConnector, registerConnector } from '../../../../../src/shared/venues/venue-registry.ts';

afterEach(() => { forgetConnector('empty'); });

let lastKernel: ReturnType<typeof createIndicatorKernel> | null = null;

function renderDialog(): { opened: WatchedPair[] } {
    const opened: WatchedPair[] = [];
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
        <MarketsDialog
            isOpen
            onOpenChange={() => undefined}
            open={null}
            onOpen={(pair) => { opened.push(pair); }}
        />
    ));
    return { opened };
}

/** Points the listing at the shipped venue and waits for it to answer. */
async function browse(venue = FIRST_VENUE): Promise<void> {
    fireEvent.click(screen.getByRole('button', { name: venue }));
    await waitFor(() => {
        expect(screen.getByRole('button', { name: /Add BTCUSDT to/ })).toBeDefined();
    });
}

/**
 * One list's row in the rail.
 *
 * By a name that begins with the list's own, because the star buttons and the
 * delete button all carry that name somewhere in theirs too.
 */
function railRow(name: string): HTMLElement {
    return screen.getByRole('button', { name: new RegExp(`^${name}`) });
}

/** Makes a list and leaves it open, the way a reader would. */
function makeList(name: string): void {
    fireEvent.click(screen.getByRole('button', { name: 'New list' }));
    fireEvent.change(screen.getByLabelText('Name this list'), { target: { value: name } });
    fireEvent.keyDown(screen.getByLabelText('Name this list'), { key: 'Enter' });
}

describe('the card a reader picks a contract on', () => {
    it('opens on the list every reader starts with', () => {
        renderDialog();

        expect(railRow('Favourites').getAttribute('aria-current')).toBe('true');
    });

    it('says the list is empty rather than showing a blank stretch', () => {
        renderDialog();

        expect(screen.getByText(/Nothing in this list yet/)).toBeDefined();
    });

    it('offers every venue and every list from the one rail', () => {
        renderDialog();

        expect(screen.getByRole('button', { name: FIRST_VENUE })).toBeDefined();
        expect(railRow('Favourites')).toBeDefined();
    });

    it('asks the venue what it trades the moment one is picked', async () => {
        renderDialog();

        await browse();

        expect(screen.getByRole('button', { name: /Add NANOUSDT to/ })).toBeDefined();
    });
});

describe('narrowing a venue listing', () => {
    it('searches by asset as well as by symbol', async () => {
        renderDialog();
        await browse();

        fireEvent.change(screen.getByLabelText('Search pairs'), { target: { value: 'NANO' } });

        expect(screen.queryByRole('button', { name: /Add BTCUSDT to/ })).toBeNull();
        expect(screen.getByRole('button', { name: /Add NANOUSDT to/ })).toBeDefined();
    });

    it('offers the venue\'s own quote currencies as chips', async () => {
        renderDialog();
        await browse();

        expect(screen.getByRole('button', { name: 'USDT' }).getAttribute('aria-pressed')).toBe('false');
        expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true');
    });

    it('narrows to a quote when its chip is pressed', async () => {
        renderDialog();
        await browse();

        fireEvent.click(screen.getByRole('button', { name: 'USDT' }));

        expect(screen.getByRole('button', { name: 'USDT' }).getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByRole('button', { name: /Add BTCUSDT to/ })).toBeDefined();
    });
});

describe('keeping a pair', () => {
    it('puts it in the open list', async () => {
        renderDialog();
        await browse();

        fireEvent.click(screen.getByRole('button', { name: /Add BTCUSDT to Favourites/ }));

        expect(screen.getByRole('button', { name: /Take BTCUSDT out of Favourites/ })).toBeDefined();
    });

    it('goes into the list the reader has open rather than always the first', async () => {
        renderDialog();
        makeList('Shitcoins');
        await browse();

        fireEvent.click(screen.getByRole('button', { name: /Add NANOUSDT to Shitcoins/ }));

        expect(railRow('Shitcoins').textContent).toContain('1');
    });

    it('says which list the next star lands in, even while browsing a venue', async () => {
        // A reader who has walked away from their lists to a venue cannot see
        // which one is selected without being told.
        renderDialog();
        makeList('Shitcoins');
        await browse();

        expect(screen.getByText(/Starring adds to Shitcoins/)).toBeDefined();
    });

    it('opens the list it has just made, because that is where the next star goes', () => {
        renderDialog();

        makeList('Shitcoins');

        expect(railRow('Shitcoins').getAttribute('aria-current')).toBe('true');
    });
});

describe('what each half marks', () => {
    it('marks the handful a venue lists that this chart actually holds', async () => {
        // The reason nothing else opens is true of nine hundred rows, and a
        // column that repeats it nine hundred times says nothing.
        renderDialog();
        await browse();

        const held = screen.getByRole('button', { name: /Open BTCUSDT on the chart/ });
        expect(held.textContent).toContain('recorded');
        expect(screen.getByRole('button', { name: /^NANOUSDT/ }).textContent)
            .not.toContain('Nothing recorded');
    });

    it('says why on a list, where a reader kept the pair themselves', async () => {
        renderDialog();
        await browse();
        fireEvent.click(screen.getByRole('button', { name: /Add NANOUSDT to Favourites/ }));
        fireEvent.click(railRow('Favourites'));

        expect(screen.getByRole('button', { name: /NANOUSDT — Nothing recorded here yet/ }).textContent)
            .toContain('Nothing recorded here yet');
    });
});

describe('opening what is kept', () => {
    it('hands back the venue as well as the symbol', async () => {
        const { opened } = renderDialog();
        await browse();
        fireEvent.click(screen.getByRole('button', { name: /Add BTCUSDT to Favourites/ }));
        fireEvent.click(railRow('Favourites'));

        fireEvent.click(screen.getByRole('button', { name: /Open BTCUSDT on the chart/ }));

        expect(opened[0]).toEqual({ venue: FIRST_VENUE, symbol: 'BTCUSDT' });
    });

    it('will not open a pair nothing has recorded, and says why', async () => {
        const { opened } = renderDialog();
        await browse();
        fireEvent.click(screen.getByRole('button', { name: /Add NANOUSDT to Favourites/ }));
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
        renderDialog();

        act(() => {
            lastKernel!.container.markets.addPair(FAVOURITES_ID, { venue: 'empty', symbol: 'FOO-BAR' });
        });

        expect(screen.getByRole('button', { name: /FOO-BAR — This venue declares no book/ })).toBeDefined();
    });
});
