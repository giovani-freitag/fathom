import {
    CONTROL_CHIP_CLASSES,
    CONTROL_OFFERED_CLASSES,
} from '../../ui/control-shell.ts';
import { ConfirmDialog } from '../../ui/confirm-dialog.tsx';
import { Trash2 } from 'lucide-react';
import { type GridChoice, offerGrids } from '../../markets/recordable.ts';
import { ListingCard, SearchField } from '../../ui/markets/listing-card.tsx';
import { ListingRefusal } from '../../ui/markets/listing-refusal.tsx';
import { narrowPairs, summariseQuotes } from '../../markets/pair-listing.ts';
import { type ReactElement, useEffect, useMemo, useState } from 'react';
import { PairIdentity } from '../../ui/markets/pair-identity.tsx';
import { RailHeading, RailRow } from '../../ui/markets/rail-row.tsx';
import type { RecordedContract } from '../../../shared/core/recording-control.ts';
import { SCROLLER_CLASSES } from '../../ui/control-shell.ts';
import { ToggleSwitch } from '../../ui/toggle-switch.tsx';
import type { Translate } from '../../i18n/translator.ts';
import { useMarkets } from '../../react/use-markets.ts';
import type { VenueInstrument } from '../../../shared/core/venue-connector.ts';

export interface RecordingListingProps {
    /** The venues that publish a book, which are the only ones worth offering. */
    readonly venues: readonly string[];
    /** The venues that publish none, named so the absence is not a mystery. */
    readonly silent: readonly string[];
    readonly contracts: readonly RecordedContract[];
    readonly isSaving: boolean;
    readonly translate: Translate;
    readonly onRecord: (venue: string, instrument: VenueInstrument, priceBucketSize: number) => void;
    /** Turns a contract's recording on or off, from the row it is listed on. */
    readonly onToggle: (contract: RecordedContract, isEnabled: boolean) => void;
    /** Takes a contract off the list and deletes what it recorded. */
    readonly onRemove: (contract: RecordedContract) => void;
}

/**
 * The pairs a venue offers to record, read the way every listing here is read.
 *
 * The same shape as the contract picker rather than a list squeezed into the
 * panel beside the chart: a venue lists a thousand pairs, and a rail three
 * hundred pixels wide showing eight of them at a time is a scroll bar inside a
 * scroll bar. Search along the top, venues down the side, rows filling the rest.
 *
 * A step inside the panel that asked for it, not a card floating beside it. A
 * popover hung off a control that is itself inside a popover is placed against
 * its trigger and sized against the window, and on a phone those two answers
 * differ by more than the screen is wide — the card rendered off the edge with
 * every switch and every delete button past it, unreachable.
 */
export function RecordingListing(props: RecordingListingProps): ReactElement {
    const { state, markets } = useMarkets();
    const [venue, setVenue] = useState(props.venues[0] ?? '');
    const [query, setQuery] = useState('');
    const [quote, setQuote] = useState('');
    const [chosen, setChosen] = useState<string | null>(null);
    // Which contract is being deleted, while the reader is being asked about it.
    const [dropping, setDropping] = useState<RecordedContract | null>(null);

    const listing = state.listings[venue];
    // Only where nobody has asked yet. Asked again while one is in flight, each
    // pass aborts the last and starts another, and the listing never lands.
    useEffect(() => {
        if (venue !== '' && (listing === undefined || listing.kind === 'unread')) {
            void markets.readListing(venue);
        }
    }, [listing, markets, venue]);

    const listed = listing?.kind === 'read' || listing?.kind === 'reading' ? listing.instruments : null;
    const quotes = useMemo(() => (listed === null ? [] : summariseQuotes(listed)), [listed]);
    const narrowed = useMemo(
        () => (listed === null ? null : narrowPairs(listed, { query, quote })),
        [listed, query, quote],
    );

    // What this venue is already recording, lifted out of the listing and put
    // at the top of it. A reader who came here to switch one off would
    // otherwise be searching a thousand rows for the four they own — and the
    // rest of the list is a catalogue, while these four are a machine that is
    // running.
    const shown = useMemo(() => {
        const held = new Map(props.contracts
            .filter((contract) => contract.venue === venue)
            .map((contract) => [contract.instrumentSymbol, contract]));
        const rows = (narrowed?.shown ?? []).map((instrument) => ({
            instrument,
            contract: held.get(instrument.symbol) ?? null,
        }));
        const listedHere = new Set(rows.map((row) => row.instrument.symbol));

        // A contract is shown because it is being recorded, not because it
        // happened to fall inside the rows the listing was cut to. A venue
        // lists a thousand pairs and the listing stops at a couple of hundred,
        // so a pair recorded from the far end of the alphabet was reachable
        // only by searching for a name the reader had no way to know — and a
        // recording nobody can see is a recording nobody can stop.
        const unlisted = [...held.values()]
            .filter((contract) => !listedHere.has(contract.instrumentSymbol))
            .map((contract) => ({ instrument: standInFor(contract), contract }));

        const kept = [...rows.filter((row) => row.contract !== null), ...unlisted];

        // Split rather than one group headed "Recording", which said the word
        // over rows whose switch was off. The switch is 20 pixels tall and it
        // was the only thing telling them apart.
        return {
            recording: kept.filter((row) => row.contract?.isEnabled === true),
            paused: kept.filter((row) => row.contract?.isEnabled === false),
            offered: rows.filter((row) => row.contract === null),
        };
    }, [narrowed, props.contracts, venue]);

    return (
        <ListingCard
            search={(
                <SearchField
                    hasFocus
                    name="recordSearch"
                    label={props.translate('markets.searchPairs')}
                    value={query}
                    onChange={setQuery}
                />
            )}
            rail={(
                <nav
                    aria-label={props.translate('recording.pickerTitle')}
                    className={`flex shrink-0 gap-1 overflow-x-auto border-hairline p-2 ${SCROLLER_CLASSES}`
                                    + ' lg:w-56 lg:flex-col lg:overflow-y-auto lg:border-r lg:[mask-image:none]'}
                >
                    <RailHeading said={props.translate('recording.venuesWithBook')} />
                    {props.venues.map((one) => (
                        <RailRow
                            key={one}
                            said={one}
                            isOn={one === venue}
                            count={props.contracts.filter((held) => held.venue === one).length}
                            onPress={() => { setVenue(one); setChosen(null); setQuery(''); setQuote(''); }}
                        />
                    ))}
                    {props.silent.length > 0 && (
                        <p className="hidden panel-note lg:block">
                            {props.translate('recording.venuesWithoutBook', {
                                venues: props.silent.join(', '),
                            })}
                        </p>
                    )}
                </nav>
            )}
            banner={(
                <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-hairline px-3 py-2">
                    <span className="text-[11px] text-ink-500">{venue}</span>
                    {quotes.length > 0 && (
                        <div className="ml-auto flex flex-wrap gap-1">
                            {['', ...quotes].map((one) => (
                                <button
                                    key={one === '' ? 'all' : one}
                                    type="button"
                                    aria-pressed={quote === one}
                                    onClick={() => { setQuote(one); }}
                                    className={`${CONTROL_CHIP_CLASSES} h-7 justify-center px-2.5 ${
                                        quote === one ? 'border-phosphor/60 bg-phosphor/12 text-phosphor' : CONTROL_OFFERED_CLASSES
                                    }`}
                                >
                                    {one === '' ? props.translate('markets.allQuotes') : one}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
            footing={narrowed !== null && narrowed.matched > narrowed.shown.length
                ? (
                    <p className="shrink-0 border-t border-hairline px-3 py-2 text-[11px] text-ink-500">
                        {props.translate('markets.shownOf', {
                            shown: String(narrowed.shown.length),
                            matched: String(narrowed.matched),
                        })}
                    </p>
                )
                : null}
        >
            {listing?.kind === 'refused'
                ? (
                    // A venue that refused and a venue still answering read the
                    // same from here, and saying "asking" about a request that
                    // already failed and will never be sent again leaves the
                    // reader waiting on nothing until they reload the page.
                    <ListingRefusal
                        said={listing.said ?? props.translate('markets.noConnector')}
                        retryLabel={props.translate('markets.retry')}
                        onRetry={() => { void markets.readListing(venue); }}
                    />
                )
                : narrowed === null
                    ? (
                        <p className="min-h-0 flex-1 px-3 py-4 text-xs leading-snug text-ink-500">
                            {props.translate('markets.reading')}
                        </p>
                    )
                    : (
                        <ul
                            aria-label={props.translate('recording.pickerTitle')}
                            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
                        >
                            {GROUPS.map((group) => ({ said: group.said, rows: shown[group.of] }))
                                .filter((group) => group.rows.length > 0).map((group) => (
                                    <li key={group.said}>
                                        <p className="sticky top-0 z-10 bg-abyss-800/95 px-3 py-1 field-label">
                                            {props.translate(group.said)}
                                        </p>
                                        <ul>
                                            {group.rows.map((row) => (
                                                <PairRow
                                                    key={row.instrument.symbol}
                                                    instrument={row.instrument}
                                                    contract={row.contract}
                                                    lastPrice={state.prices[`${venue}/${row.instrument.symbol}`] ?? null}
                                                    isOpen={chosen === row.instrument.symbol}
                                                    isSaving={props.isSaving}
                                                    translate={props.translate}
                                                    onOpen={() => {
                                                        setChosen(chosen === row.instrument.symbol
                                                            ? null
                                                            : row.instrument.symbol);
                                                        void markets.readLastPrice(venue, row.instrument.symbol);
                                                    }}
                                                    onRecord={(priceBucketSize) => {
                                                        props.onRecord(venue, row.instrument, priceBucketSize);
                                                        setChosen(null);
                                                    }}
                                                    onToggle={(isEnabled) => {
                                                        if (row.contract !== null) {
                                                            props.onToggle(row.contract, isEnabled);
                                                        }
                                                    }}
                                                    onRemove={() => { setDropping(row.contract); }}
                                                />
                                            ))}
                                        </ul>
                                    </li>
                                ))}
                        </ul>
                    )}
            <ConfirmDialog
                isOpen={dropping !== null}
                onOpenChange={(isOpen) => { if (!isOpen) { setDropping(null); } }}
                title={props.translate('recording.removeTitle')}
                body={props.translate('recording.removeBody', {
                    symbol: dropping?.instrumentSymbol ?? '',
                })}
                confirmLabel={props.translate('recording.removeConfirm')}
                onConfirm={() => {
                    if (dropping !== null) {
                        props.onRemove(dropping);
                    }
                    setDropping(null);
                }}
            />
        </ListingCard>
    );
}

/**
 * One grid on offer, carrying the figure and nothing else.
 *
 * The words are on the line that asks — "one row of the heat map covers" — and
 * repeating them on each of three chips makes the reader read the same phrase
 * three times to compare three numbers. Said in full where it is read out,
 * because a button announced as "point one" alone says nothing.
 */
function GridChip({ grid, isChosen, isSaving, translate, onPick }: {
    readonly grid: GridChoice;
    /** True where the contract already records on it. */
    readonly isChosen: boolean;
    readonly isSaving: boolean;
    readonly translate: Translate;
    readonly onPick: () => void;
}): ReactElement {
    return (
        <button
            type="button"
            disabled={isSaving || isChosen}
            aria-label={translate('settings.perRow', { value: grid.priceBucketSize })}
            onClick={onPick}
            className={`${CONTROL_CHIP_CLASSES} numeric h-7 justify-center px-2.5 ${
                isChosen || grid.isSuggested
                    ? 'border-phosphor/60 bg-phosphor/12 text-phosphor'
                    : CONTROL_OFFERED_CLASSES
            }`}
        >
            {grid.priceBucketSize}
        </button>
    );
}

/**
 * A row for a contract the listing did not reach.
 *
 * Only the symbol is known, which is the one field every control on the row
 * needs. The rest is what the pair would look like to a reader who cannot see
 * it: no tick published, and nothing claiming it is trading.
 */
/** The three headings a pair can sit under, in the order they are read. */
const GROUPS = [
    { said: 'recording.recordingHere', of: 'recording' },
    { said: 'recording.switchedOffHere', of: 'paused' },
    { said: 'recording.everythingElse', of: 'offered' },
] as const;

function standInFor(contract: RecordedContract): VenueInstrument {
    return {
        symbol: contract.instrumentSymbol,
        base: contract.instrumentSymbol,
        quote: '',
        priceStep: 0,
        isTrading: false,
    };
}

interface PairRowProps {
    readonly instrument: VenueInstrument;
    /** The contract recording it, or null where nothing is. */
    readonly contract: RecordedContract | null;
    /** What it last traded at, which is what the grids are a band of. */
    readonly lastPrice: number | null;
    /** True while this row is showing the grids it could be recorded on. */
    readonly isOpen: boolean;
    readonly isSaving: boolean;
    readonly translate: Translate;
    readonly onOpen: () => void;
    readonly onRecord: (priceBucketSize: number) => void;
    readonly onToggle: (isEnabled: boolean) => void;
    readonly onRemove: () => void;
}

/**
 * One pair: the switch where it is recorded, and the grid question where it is not.
 *
 * The switch lives on the row rather than in a list of its own, because they
 * are one question asked of one pair. The grid is asked before the recording
 * starts and never after: a contract recorded on one and re-recorded on another
 * has two grids in one history, and nothing downstream can tell which row
 * belongs to which.
 */
function PairRow(props: PairRowProps): ReactElement {
    const grids = offerGrids(props.instrument, props.lastPrice);

    if (props.contract !== null) {
        const contract = props.contract;
        return (
            <li className="border-b border-hairline/40">
                <div className="flex items-center gap-3 px-3 py-2">
                    <PairIdentity
                        symbol={props.instrument.symbol}
                        base={props.instrument.base}
                        quote={props.instrument.quote}
                    />
                    {/* The grid is a control here rather than a reading: it can
                        be changed, and what that costs is worth one press to
                        find out rather than a decision made once for ever. */}
                    <button
                        type="button"
                        aria-expanded={props.isOpen}
                        aria-label={props.translate('recording.regrid', { symbol: props.instrument.symbol })}
                        onClick={props.onOpen}
                        className="numeric ml-auto shrink-0 rounded px-1.5 py-0.5 pl-2 text-[11px] text-ink-500 transition-colors hover:bg-abyss-700 hover:text-ink-200"
                    >
                        {props.translate('settings.perRow', { value: contract.priceBucketSize })}
                    </button>
                    <ToggleSwitch
                        isOn={contract.isEnabled}
                        isDisabled={props.isSaving}
                        onChange={props.onToggle}
                        label={props.translate('recording.toggle', { symbol: props.instrument.symbol })}
                    />
                    {/* Apart from the switch, and further from the thumb: one
                        keeps everything that was captured and the other is the
                        only control here that cannot be taken back. */}
                    <button
                        type="button"
                        disabled={props.isSaving}
                        aria-label={props.translate('recording.remove', { symbol: props.instrument.symbol })}
                        onClick={props.onRemove}
                        className="grid size-7 shrink-0 place-items-center rounded text-ink-500 transition-colors hover:bg-abyss-700 hover:text-ask"
                    >
                        <Trash2 size={13} />
                    </button>
                </div>

                {props.isOpen && grids.length > 0 && (
                    <div className="border-t border-hairline/40 bg-abyss-900/40 px-3 py-2">
                        <div className="flex flex-wrap items-center gap-1">
                            <span className="mr-1 text-[11px] text-ink-500">
                                {props.translate('recording.gridPrompt')}
                            </span>
                            {grids.map((grid) => (
                                <GridChip
                                    key={grid.priceBucketSize}
                                    grid={grid}
                                    isChosen={grid.priceBucketSize === contract.priceBucketSize}
                                    isSaving={props.isSaving}
                                    translate={props.translate}
                                    onPick={() => { props.onRecord(grid.priceBucketSize); }}
                                />
                            ))}
                        </div>
                        <p className="panel-note mt-1.5">{props.translate('recording.regridCost')}</p>
                    </div>
                )}
            </li>
        );
    }

    return (
        <li className="border-b border-hairline/40">
            <button
                type="button"
                disabled={grids.length === 0}
                onClick={props.onOpen}
                className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-abyss-700 disabled:hover:bg-transparent"
            >
                <PairIdentity
                    symbol={props.instrument.symbol}
                    base={props.instrument.base}
                    quote={props.instrument.quote}
                />
                <span className="ml-auto shrink-0 pl-2 text-[11px] text-ink-500">
                    {grids.length === 0
                        ? props.translate('recording.noGrid')
                        : props.translate('recording.choose')}
                </span>
            </button>

            {props.isOpen && grids.length > 0 && (
                <div className="flex flex-wrap items-center gap-1 border-t border-hairline/40 bg-abyss-900/40 px-3 py-2">
                    <span className="mr-1 text-[11px] text-ink-500">
                        {props.translate('recording.gridPrompt')}
                    </span>
                    {grids.map((grid) => (
                        <GridChip
                            key={grid.priceBucketSize}
                            grid={grid}
                            isChosen={false}
                            isSaving={props.isSaving}
                            translate={props.translate}
                            onPick={() => { props.onRecord(grid.priceBucketSize); }}
                        />
                    ))}
                </div>
            )}
        </li>
    );
}
