import { afterEach, describe, expect, it } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { createIndicatorKernel, renderWithKernel } from '../../../../mocks/indicator-kernel.tsx';
import { FAVOURITES_ID, type MarketPair } from '../../../../../src/shared/core/pair-tags.ts';
import { FIRST_VENUE } from '../../../../../src/shared/core/recording-control.ts';
import { MarketsPanel } from '../../../../../src/app/ui/markets/markets-panel.tsx';
import { buildConnector } from '../../../../mocks/venue-connectors.ts';
import { forgetConnector, registerConnector } from '../../../../../src/shared/venues/venue-registry.ts';
import { stubViewport } from '../../../../fixtures/viewport.ts';

// The rail and the phone's select are different trees, so every test here
// says which one it is about. These describe the rail.
const showAt = stubViewport();

afterEach(() => { forgetConnector('empty'); showAt(1_280); });

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
        expect(screen.getByRole('button', { name: 'Tags on BTCUSDT' })).toBeDefined();
    });
}

/**
 * Opens one row's tag menu, the way a pointer does.
 *
 * On `pointerdown` rather than on a click, which is where the menu primitive
 * listens — a click alone leaves it shut and every query after it empty.
 */
function openTags(symbol: string): void {
    fireEvent.pointerDown(
        screen.getByRole('button', { name: `Tags on ${symbol}` }),
        { button: 0, ctrlKey: false },
    );
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

        expect(screen.getByRole('button', { name: 'Tags on NANOUSDT' })).toBeDefined();
    });
});

describe('taking a tag away', () => {
    it('asks first, where the tag holds pairs', async () => {
        // A tag with a morning's work in it goes in one press and comes back in
        // none, so the press that costs something is the one that asks.
        renderPanel();
        makeTag('Shitcoins');
        await browse();
        openTags('BTCUSDT');
        fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'File BTCUSDT under Shitcoins' }));
        fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

        fireEvent.click(screen.getByRole('button', { name: 'Delete this tag Shitcoins' }));

        expect(screen.getByText(/holds 1 pairs/)).toBeDefined();
        // Backed out of, the tag and its pair are still there.
        fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
        expect(railRow('Shitcoins').textContent).toContain('1');
    });

    it('takes an empty one away without asking, because nothing is lost', () => {
        renderPanel();
        makeTag('Shitcoins');

        fireEvent.click(screen.getByRole('button', { name: 'Delete this tag Shitcoins' }));

        expect(screen.queryByRole('button', { name: /^Shitcoins/ })).toBeNull();
    });
});

describe('pointing the listing somewhere else', () => {
    it('clears what was typed at the venue before it', async () => {
        // Carried across, a search of one venue answers a question about the
        // next one with no rows and no sign of why.
        renderPanel();
        await browse();
        fireEvent.change(screen.getByLabelText('Search pairs'), { target: { value: 'NANO' } });

        fireEvent.click(railRow('Favourites'));

        expect(screen.getByLabelText('Search pairs').getAttribute('value')).toBe('');
    });
});

describe('searching a venue that answers searches itself', () => {
    /** A venue whose listing is paged, and which matches typing on its own. */
    function registerSearchable(): void {
        registerConnector('searchable', Object.assign(
            buildConnector({ book: null, tape: null, bars: null }),
            {
                planInstruments: () => ({ url: 'https://venue.test/symbols' }),
                readInstruments: (payload: unknown) => (payload as { symbols: [] }).symbols.map((one) => {
                    const listed = one as { symbol: string; baseAsset: string; quoteAsset: string };
                    return {
                        symbol: listed.symbol,
                        base: listed.baseAsset,
                        quote: listed.quoteAsset,
                        priceStep: 0.1,
                        isTrading: true,
                    };
                }),
                planInstrumentSearch: (term: string) => ({ url: `https://venue.test/symbols?search=${term}` }),
            },
        ));
    }

    afterEach(() => { forgetConnector('searchable'); });

    it('shows what the venue matched, not what the page happened to hold', async () => {
        // The reason it exists: a listing still arriving is a listing whose
        // search says "not listed" about pairs that are.
        registerSearchable();
        renderPanel();
        fireEvent.click(screen.getByRole('button', { name: 'searchable' }));
        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Tags on BTCUSDT' })).toBeDefined();
        });

        fireEvent.change(screen.getByLabelText('Search pairs'), { target: { value: 'found' } });

        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Tags on FOUNDUSDT' })).toBeDefined();
        });
    });

    it('searches what it has read where the venue offers no search of its own', async () => {
        renderPanel();
        await browse();

        fireEvent.change(screen.getByLabelText('Search pairs'), { target: { value: 'NANO' } });

        await waitFor(() => {
            expect(screen.queryByRole('button', { name: 'Tags on BTCUSDT' })).toBeNull();
        });
        expect(screen.getByRole('button', { name: 'Tags on NANOUSDT' })).toBeDefined();
    });
});

describe('narrowing a venue listing', () => {
    it('searches by asset as well as by symbol', async () => {
        renderPanel();
        await browse();

        fireEvent.change(screen.getByLabelText('Search pairs'), { target: { value: 'NANO' } });

        expect(screen.queryByRole('button', { name: /File BTCUSDT under/ })).toBeNull();
        expect(screen.getByRole('button', { name: 'Tags on NANOUSDT' })).toBeDefined();
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
        expect(screen.getByRole('button', { name: 'Tags on BTCUSDT' })).toBeDefined();
    });
});

describe('keeping a pair', () => {
    it('files it under a tag named on the row itself', async () => {
        renderPanel();
        await browse();

        openTags('BTCUSDT');
        fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'File BTCUSDT under Favourites' }));

        expect(screen.getByRole('menuitemcheckbox', { name: 'Take BTCUSDT out of Favourites' })).toBeDefined();
    });

    it('takes it out again from the same menu', async () => {
        // The half a rail-chosen target could not do at all: a pair can only be
        // taken out of the tag a reader is already looking at.
        renderPanel();
        await browse();
        openTags('BTCUSDT');
        fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'File BTCUSDT under Favourites' }));

        fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Take BTCUSDT out of Favourites' }));

        expect(railRow('Favourites').textContent).not.toContain('1');
    });

    it('offers every tag on every row, whichever one the rail is on', async () => {
        renderPanel();
        makeTag('Shitcoins');
        await browse();

        openTags('NANOUSDT');
        fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'File NANOUSDT under Shitcoins' }));

        expect(railRow('Shitcoins').textContent).toContain('1');
    });

    it('stays open while a pair is filed under a second tag', async () => {
        // A pair under two tags is the case tags exist for, and a menu that
        // shuts on the first one makes it two trips.
        renderPanel();
        makeTag('Shitcoins');
        await browse();

        openTags('BTCUSDT');
        fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'File BTCUSDT under Favourites' }));
        fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'File BTCUSDT under Shitcoins' }));

        expect(railRow('Favourites').textContent).toContain('1');
        expect(railRow('Shitcoins').textContent).toContain('1');
    });

    it('marks the row with every tag the pair carries', async () => {
        // The whole of what a tag gives a list: one pair under two of them, and
        // a reader who can see both without opening anything.
        renderPanel();
        makeTag('Shitcoins');
        await browse();
        openTags('BTCUSDT');
        fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'File BTCUSDT under Favourites' }));
        fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'File BTCUSDT under Shitcoins' }));
        fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

        const trigger = screen.getByRole('button', { name: 'Tags on BTCUSDT' });
        expect(trigger.querySelectorAll('span.rounded-full')).toHaveLength(2);
    });

    it('opens the tag it has just made, because that is where a reader is heading', () => {
        renderPanel();

        makeTag('Shitcoins');

        expect(railRow('Shitcoins').getAttribute('aria-current')).toBe('true');
    });
});

describe('the colour a tag is marked in', () => {
    /** The swatch on a tag's row in the rail, which is also its colour control. */
    function colourControl(name: string): HTMLElement {
        return screen.getByRole('button', { name: `Change this tag's colour — ${name}` });
    }

    it('offers the chart\'s own colours, which follow the reader between themes', () => {
        renderPanel();

        fireEvent.click(colourControl('Favourites'));
        fireEvent.click(screen.getByRole('button', { name: 'Blue' }));

        expect(colourControl('Favourites').querySelector('.bg-cyan')).not.toBeNull();
    });

    it('takes any colour a reader names, because tags outnumber the palette', () => {
        // Five colours and no limit on tags: a reader on their eighth has run
        // out of palette, not out of tags.
        renderPanel();

        fireEvent.click(colourControl('Favourites'));
        fireEvent.change(screen.getByLabelText('Any other colour'), { target: { value: '#ff8800' } });

        expect(colourControl('Favourites').querySelector('span[style]')?.getAttribute('style'))
            .toContain('rgb(255, 136, 0)');
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
        openTags('NANOUSDT');
        fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'File NANOUSDT under Favourites' }));
        fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
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
        openTags('BTCUSDT');
        fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'File BTCUSDT under Favourites' }));
        fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
        fireEvent.click(railRow('Favourites'));

        fireEvent.click(screen.getByRole('button', { name: /Open BTCUSDT on the chart/ }));

        expect(opened[0]).toEqual({ venue: FIRST_VENUE, symbol: 'BTCUSDT' });
    });

    it('will not open a pair nothing has recorded, and says why', async () => {
        const { opened } = renderPanel();
        await browse();
        openTags('NANOUSDT');
        fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'File NANOUSDT under Favourites' }));
        fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
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

describe('the card on a phone', () => {
    it('asks which source outright, instead of a strip that mixes two kinds', () => {
        // Laid down, the rail put a reader's tags and the venues in one row with
        // the headings that told them apart hidden, and most of its targets past
        // the edge of the screen.
        showAt(390);
        renderPanel();

        const picker = screen.getByRole('combobox', { name: 'Contracts' });

        expect(picker).toBeDefined();
        expect(screen.queryByRole('button', { name: FIRST_VENUE })).toBeNull();
    });

    it('files the tags and the venues under headings of their own', async () => {
        showAt(390);
        renderPanel();

        fireEvent.click(screen.getByRole('combobox', { name: 'Contracts' }));

        expect(await screen.findByText('Your tags')).toBeDefined();
        expect(await screen.findByText('Venues')).toBeDefined();
    });

    it('asks for a name when a new tag is called for, on a phone too', async () => {
        // The field used to live inside the rail, which a phone does not build:
        // the press changed the state and drew nothing, so the button read as
        // dead.
        showAt(390);
        renderPanel();

        fireEvent.click(await screen.findByRole('button', { name: 'New tag' }));

        expect(await screen.findByRole('textbox', { name: 'Name this tag' })).toBeDefined();
    });

    it('files a tag named on a phone under the reader\'s own tags', async () => {
        showAt(390);
        renderPanel();
        fireEvent.click(await screen.findByRole('button', { name: 'New tag' }));

        const field = await screen.findByRole('textbox', { name: 'Name this tag' });
        fireEvent.change(field, { target: { value: 'Majors' } });
        fireEvent.keyDown(field, { key: 'Enter' });

        // Made and left open, so the select is now showing it.
        expect((await screen.findByRole('combobox', { name: 'Contracts' })).textContent)
            .toContain('Majors');
    });

    it('gives up on a half-typed tag name without taking the card with it', async () => {
        // The card closes on Escape as well, so the key that abandons a field
        // used to abandon everything behind it.
        showAt(390);
        renderPanel();
        fireEvent.click(await screen.findByRole('button', { name: 'New tag' }));

        const field = await screen.findByRole('textbox', { name: 'Name this tag' });
        fireEvent.change(field, { target: { value: 'half' } });
        fireEvent.keyDown(field, { key: 'Escape' });

        expect(screen.queryByRole('textbox', { name: 'Name this tag' })).toBeNull();
        expect(await screen.findByRole('combobox', { name: 'Contracts' })).toBeDefined();
    });

    it('keeps only one of the two layouts in the tree at a time', async () => {
        // Both mounted is two of every control with the same name, and two of
        // every dialog behind them.
        showAt(1_280);
        renderPanel();

        expect(screen.queryByRole('combobox', { name: 'Contracts' })).toBeNull();
        expect(await screen.findByRole('button', { name: FIRST_VENUE })).toBeDefined();
    });
});
