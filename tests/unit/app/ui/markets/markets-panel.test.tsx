import { afterEach, describe, expect, it } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { createIndicatorKernel, renderWithKernel } from '../../../../mocks/indicator-kernel.tsx';
import { FIRST_VENUE } from '../../../../../src/shared/core/recording-control.ts';
import { FAVOURITES_ID } from '../../../../../src/shared/core/watch-lists.ts';
import { MarketsPanel } from '../../../../../src/app/ui/markets/markets-panel.tsx';
import { buildConnector } from '../../../../mocks/venue-connectors.ts';
import { forgetConnector, registerConnector } from '../../../../../src/shared/venues/venue-registry.ts';
import type { WatchedPair } from '../../../../../src/shared/core/watch-lists.ts';

afterEach(() => { forgetConnector('empty'); });

let lastKernel: ReturnType<typeof createIndicatorKernel> | null = null;

function renderPanel(): { opened: WatchedPair[] } {
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
        <MarketsPanel open={null} onOpen={(pair) => { opened.push(pair); }} />
    ));
    return { opened };
}

/** Waits for the venue's listing to land, which every browse test needs first. */
async function browsedPairs(): Promise<void> {
    await waitFor(() => {
        expect(screen.getByRole('button', { name: /Add BTCUSDT to/ })).toBeDefined();
    });
}

describe('the panel a reader picks a contract in', () => {
    it('opens on the list every reader starts with', () => {
        renderPanel();

        expect(screen.getByRole('button', { name: /Favourites/ }).getAttribute('aria-pressed')).toBe('true');
    });

    it('says the list is empty rather than showing a blank stretch', () => {
        renderPanel();

        expect(screen.getByText(/Nothing in this list yet/)).toBeDefined();
    });

    it('asks the venue what it trades without being told to', async () => {
        renderPanel();

        await browsedPairs();

        expect(screen.getByRole('button', { name: /Add NANOUSDT to/ })).toBeDefined();
    });
});

describe('keeping a pair', () => {
    it('puts it in the open list, where it can then be opened', async () => {
        renderPanel();
        await browsedPairs();

        fireEvent.click(screen.getByRole('button', { name: /Add BTCUSDT to Favourites/ }));

        // Two: the row in the listing, now starred, and the row in the list it
        // was starred into — which is the whole point of the panel holding both.
        expect(screen.getAllByRole('button', { name: /Take BTCUSDT out of Favourites/ })).toHaveLength(2);
    });

    it('goes into the list the reader has open rather than always the first', async () => {
        renderPanel();
        await browsedPairs();
        fireEvent.click(screen.getByRole('button', { name: 'New list' }));
        fireEvent.change(screen.getByLabelText('Name this list'), { target: { value: 'Shitcoins' } });
        fireEvent.keyDown(screen.getByLabelText('Name this list'), { key: 'Enter' });

        fireEvent.click(screen.getByRole('button', { name: /Add NANOUSDT to Shitcoins/ }));

        expect(screen.getByRole('button', { name: /^Shitcoins/ }).textContent).toContain('1');
    });

    it('opens the list it has just made, because that is where the next star goes', () => {
        renderPanel();

        fireEvent.click(screen.getByRole('button', { name: 'New list' }));
        fireEvent.change(screen.getByLabelText('Name this list'), { target: { value: 'Shitcoins' } });
        fireEvent.keyDown(screen.getByLabelText('Name this list'), { key: 'Enter' });

        expect(screen.getByRole('button', { name: /Shitcoins/ }).getAttribute('aria-pressed')).toBe('true');
    });
});

describe('opening what is kept', () => {
    it('hands back the venue as well as the symbol', async () => {
        const { opened } = renderPanel();
        await browsedPairs();
        fireEvent.click(screen.getByRole('button', { name: /Add BTCUSDT to Favourites/ }));

        fireEvent.click(screen.getAllByRole('button', { name: /BTCUSDT/ })[0]!);

        expect(opened[0]).toEqual({ venue: FIRST_VENUE, symbol: 'BTCUSDT' });
    });

    it('will not open a pair nothing has recorded, and says why', async () => {
        // A row that silently does nothing when pressed is worse than one that
        // says there is no recording behind it yet.
        const { opened } = renderPanel();
        await browsedPairs();
        fireEvent.click(screen.getByRole('button', { name: /Add NANOUSDT to Favourites/ }));

        const kept = screen.getAllByRole('button', { name: /NANOUSDT/ })[0]!;
        fireEvent.click(kept);

        expect(kept.hasAttribute('disabled')).toBe(true);
        expect(opened).toEqual([]);
    });
});

describe('why a kept pair cannot be opened', () => {
    it('says nothing was recorded, on a venue that does publish a book', async () => {
        const { opened } = renderPanel();
        await browsedPairs();
        fireEvent.click(screen.getByRole('button', { name: /Add NANOUSDT to Favourites/ }));

        expect(screen.getAllByRole('button', { name: /NANOUSDT/ })[0]!.textContent)
            .toContain('Nothing recorded here yet');
        expect(opened).toEqual([]);
    });

    it('says the venue draws nothing, where its connector declared nothing', () => {
        // Two different answers on purpose: a reader who reads the first one for
        // the second goes looking for a broken recording instead of for the
        // `null` their own connector declared.
        registerConnector('empty', buildConnector({ book: null, tape: null, bars: null }));
        renderPanel();

        act(() => {
            lastKernel!.container.markets.addPair(FAVOURITES_ID, { venue: 'empty', symbol: 'FOO-BAR' });
        });

        expect(screen.getAllByRole('button', { name: /FOO-BAR/ })[0]!.textContent)
            .toContain('declares no book, tape or candles');
    });
});
