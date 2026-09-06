import {
    CONTROL_CHIP_CLASSES,
    CONTROL_CHOSEN_CLASSES,
    LIST_ROW_CLASSES,
    CONTROL_OFFERED_CLASSES,
} from '../../ui/control-shell.ts';
import { ConfirmDialog } from '../../ui/confirm-dialog.tsx';
import { Trash2 } from 'lucide-react';
import { type GridChoice, offerGrids } from '../../markets/recordable.ts';
import { ListingCard, SearchField } from '../../ui/markets/listing-card.tsx';
import { ListingBody, ListingFooting, QuoteFilter } from '../../ui/markets/listing-body.tsx';
import { VenueMark } from '../../ui/markets/venue-mark.tsx';
import { Select } from '../../ui/select.tsx';
import { useIsViewportAtLeast } from '../../react/use-viewport-width.ts';
import { narrowPairs, summariseQuotes } from '../../markets/pair-listing.ts';
import { memo, type ReactElement, useEffect, useMemo, useState } from 'react';
import { PairIdentity } from '../../ui/markets/pair-identity.tsx';
import { RailHeading, RailRow } from '../../ui/markets/rail-row.tsx';
import type { RecordedContract } from '../../../shared/core/recording-control.ts';
import { ToggleSwitch } from '../../ui/toggle-switch.tsx';
import type { Translate } from '../../i18n/translator.ts';
import { useMarkets } from '../../react/use-markets.ts';
import { useEscapeGuard } from '../../ui/escape-guard.ts';
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
    // What the rows are narrowed by, which lags what the field shows. Narrowing
    // rebuilds a hundred and fifty rows, and doing that inside the keystroke is
    // a letter that arrives late enough for a reader to press the key again.
    const [narrowedBy, setNarrowedBy] = useState('');
    useEffect(() => {
        const settling = setTimeout(() => { setNarrowedBy(query); }, TYPING_SETTLES_MS);
        return () => { clearTimeout(settling); };
    }, [query]);
    const [quote, setQuote] = useState('');
    const [chosen, setChosen] = useState<string | null>(null);
    // The catalogue is built once the thread is free, for the same reason the
    // contract listing is: a card shows a dozen rows and the group under
    // "everything else" holds a hundred and fifty, and building them all in the
    // tick the listing lands is a third of a second the reader gets nothing for.
    const [whole, setWhole] = useState<readonly VenueInstrument[] | null>(null);
    // One layout or the other, never both: two rails in the tree is two
    // controls answering to the same name.
    const isWide = useIsViewportAtLeast('lg');
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
        () => (listed === null ? null : narrowPairs(listed, { query: narrowedBy, quote })),
        [listed, narrowedBy, quote],
    );

    useEffect(() => {
        const idle = globalThis.requestIdleCallback;
        if (typeof idle !== 'function') {
            const soon = setTimeout(() => { setWhole(listed); }, 120);
            return () => { clearTimeout(soon); };
        }
        const asked = idle(() => { setWhole(listed); }, { timeout: 500 });
        return () => { globalThis.cancelIdleCallback(asked); };
    }, [listed]);

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
        //
        // Narrowed by what was typed all the same. Hoisting them past the cut
        // and past the search as well made the groups answer a question nobody
        // asked: typing a name that matches nothing left every recorded pair
        // standing there, as though they had all matched.
        const unlisted = [...held.values()]
            .filter((contract) => !listedHere.has(contract.instrumentSymbol))
            .map((contract) => ({ instrument: standInFor(contract), contract }))
            .filter((row) => narrowPairs([row.instrument], { query: narrowedBy, quote }).shown.length > 0);

        const kept = [...rows.filter((row) => row.contract !== null), ...unlisted];

        // Split rather than one group headed "Recording", which said the word
        // over rows whose switch was off. The switch is 20 pixels tall and it
        // was the only thing telling them apart.
        return {
            /** Rows lifted in past the cut, which the listing never counted. */
            unlisted: unlisted.length,
            recording: kept.filter((row) => row.contract?.isEnabled === true),
            paused: kept.filter((row) => row.contract?.isEnabled === false),
            offered: rows.filter((row) => row.contract === null),
            /** Every offered row, whether or not they are all drawn yet. */
            offeredInAll: rows.filter((row) => row.contract === null).length,
        };
    }, [narrowed, props.contracts, venue, narrowedBy, quote]);

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
            rail={isWide
                ? (
                    <nav
                        aria-label={props.translate('recording.pickerTitle')}
                        className="flex w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r border-hairline p-2"
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
                            <p className="panel-note">
                                {props.translate('recording.venuesWithoutBook', {
                                    venues: props.silent.join(', '),
                                })}
                            </p>
                        )}
                    </nav>
                )
                : (
                    // The same question the contracts picker asks on a phone,
                    // asked the same way. Laid down as a strip it hid its own
                    // heading and dropped the line saying why three venues are
                    // offered where the chart lists six.
                    <div className="flex shrink-0 flex-col gap-2 border-b border-hairline p-2">
                        <Select
                            label={props.translate('recording.pickerTitle')}
                            value={venue}
                            choices={props.venues.map((one) => ({
                                value: one,
                                label: one,
                                detail: String(props.contracts.filter((held) => held.venue === one).length),
                                group: props.translate('recording.venuesWithBook'),
                                icon: <VenueMark venue={one} />,
                            }))}
                            onSelect={(one) => { setVenue(one); setChosen(null); setQuery(''); setQuote(''); }}
                        />
                        {props.silent.length > 0 && (
                            <p className="panel-note">
                                {props.translate('recording.venuesWithoutBook', {
                                    venues: props.silent.join(', '),
                                })}
                            </p>
                        )}
                    </div>
                )}
            banner={(
                <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-hairline px-3 py-2">
                    <span className="text-[11px] text-ink-500">{venue}</span>
                    <QuoteFilter
                        quotes={quotes}
                        quote={quote}
                        translate={props.translate}
                        onPick={setQuote}
                    />
                </div>
            )}
            footing={(
                <ListingFooting
                    listing={listing ?? { kind: 'unread' }}
                    // What is on the screen, which is the listing's rows plus
                    // the recordings lifted in past the cut. Counting only the
                    // listing said "150 of 895" over 151 rows.
                    shown={shown.recording.length + shown.paused.length + shown.offered.length}
                    matched={(narrowed?.matched ?? 0) + shown.unlisted}
                    isAsking={false}
                    translate={props.translate}
                />
            )}
        >
            <ListingBody
                listing={listing ?? { kind: 'unread' }}
                rowCount={shown.recording.length + shown.paused.length + shown.offered.length}
                query={query}
                emptySaid={props.translate('markets.noPairs')}
                translate={props.translate}
                onRetry={() => { void markets.readListing(venue); }}
            >
                <ul
                    aria-label={props.translate('recording.pickerTitle')}
                    className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
                >
                    {GROUPS.map((group) => ({
                        said: group.said,
                        of: group.of,
                        rows: group.of === 'offered' && whole !== listed
                            ? shown.offered.slice(0, ROWS_AT_ONCE)
                            : shown[group.of],
                    }))
                        .filter((group) => group.rows.length > 0).map((group) => (
                            <li key={group.said}>
                                {/* A heading rather than a styled line, and
                                    named onto the list it heads: read aloud,
                                    three unlabelled lists of two, three and a
                                    hundred and forty-six rows say nothing about
                                    which pairs are recording and which are not. */}
                                <h4
                                    id={`recording-group-${group.of}`}
                                    className="sticky top-0 z-10 bg-abyss-800/95 px-3 py-1 field-label"
                                >
                                    {props.translate(group.said)}
                                </h4>
                                <ul aria-labelledby={`recording-group-${group.of}`}>
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
            </ListingBody>

            <ConfirmDialog
                isOpen={dropping !== null}
                onOpenChange={(isOpen) => { if (!isOpen) { setDropping(null); } }}
                title={props.translate('recording.removeTitle')}
                // The safer alternative it offers has to exist. Told to switch
                // off a contract that is already off, a reader looks for a
                // switch that would change nothing and concludes the dialog is
                // describing some other pair.
                body={props.translate(
                    dropping?.isEnabled === false ? 'recording.removeBodyOff' : 'recording.removeBody',
                    { symbol: dropping?.instrumentSymbol ?? '' },
                )}
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
            disabled={isSaving}
            aria-current={isChosen}
            aria-label={translate('settings.perRow', { value: grid.priceBucketSize })}
            onClick={() => { if (!isChosen) { onPick(); } }}
            className={`${CONTROL_CHIP_CLASSES} numeric h-7 justify-center px-2.5 touch:h-11 ${gridChipLook(
                isChosen,
                grid.isSuggested,
            )}`}
        >
            {grid.priceBucketSize}
        </button>
    );
}

/**
 * How a grid chip is painted, by whether it is the one in force.
 *
 * The two used to draw the same, and the one in force was the one drawn dim:
 * it is disabled, because re-picking it does nothing, and the disabled fade sat
 * on top of the chosen colour. So the bright chip was the value you were not
 * on and the faded one was where you actually were.
 */
function gridChipLook(isChosen: boolean, isSuggested: boolean): string {
    if (isChosen) {
        return `${CONTROL_CHOSEN_CLASSES} cursor-default`;
    }
    // Drawn like every other offer. It used to carry the chosen colours at a
    // lower opacity, so two chips read as picked and nothing said what the
    // second one meant.
    void isSuggested;
    return CONTROL_OFFERED_CLASSES;
}

/**
 * The ladder a grid is picked from, with the grid in force always on it.
 *
 * The rungs are computed from the last price, which moves. A contract written
 * at one figure and read back a month later was offered three others and no
 * sign of its own, so the panel showed a value the list said did not exist.
 */
function withCurrentGrid(offered: readonly GridChoice[], inForce: number | null): readonly GridChoice[] {
    if (inForce === null || offered.some((grid) => grid.priceBucketSize === inForce)) {
        return offered;
    }
    return [...offered, { priceBucketSize: inForce, isSuggested: false }]
        .sort((one, other) => one.priceBucketSize - other.priceBucketSize);
}

/**
 * A row for a contract the listing did not reach.
 *
 * Only the symbol is known, which is the one field every control on the row
 * needs. The rest is what the pair would look like to a reader who cannot see
 * it: no tick published, and nothing claiming it is trading.
 */
/** The three headings a pair can sit under, in the order they are read. */
/** How many of the catalogue's rows are built in the tick it lands. */
const ROWS_AT_ONCE = 30;

/**
 * How long typing settles before the rows are narrowed by it.
 *
 * The same figure the contracts picker uses, because it is the same wait: long
 * enough that a word is one narrowing rather than five, short enough that the
 * rows have caught up by the time a reader looks down at them.
 */
const TYPING_SETTLES_MS = 250;

const GROUPS = [
    { said: 'recording.recordingHere', of: 'recording' },
    { said: 'recording.switchedOffHere', of: 'paused' },
    { said: 'recording.everythingElse', of: 'offered' },
] as const;

function standInFor(contract: RecordedContract): VenueInstrument {
    return {
        // Left empty rather than guessed: filling the base with the symbol drew
        // the pair as "PAXGUSDT/", which is not what anything calls it. A row
        // with no assets draws none, which is the truth here.
        symbol: contract.instrumentSymbol,
        base: '',
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
/**
 * One pair's row, rebuilt only when that pair changes.
 *
 * Memoised for the same reason the contract listing's rows are: the card
 * re-renders whenever anything above the list moves — a character typed, a
 * venue picked, a contract saved — and without this every one of a hundred and
 * fifty rows is reconciled to arrive at the same row.
 */
const PairRow = memo(function PairRow(props: PairRowProps): ReactElement {
    // While this row's grids are showing, Escape belongs to them.
    useEscapeGuard(props.isOpen);

    const grids = withCurrentGrid(
        offerGrids(props.instrument, props.lastPrice),
        props.contract?.priceBucketSize ?? null,
    );

    if (props.contract !== null) {
        const contract = props.contract;
        return (
            <li className="border-b border-hairline/40">
                <div className={`${LIST_ROW_CLASSES} gap-3`}>
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
                        aria-label={props.translate('recording.regrid', {
                            symbol: props.instrument.symbol,
                            grid: props.translate('settings.perRow', { value: contract.priceBucketSize }),
                        })}
                        onClick={props.onOpen}
                        onKeyDown={(event) => {
                            if (event.key === 'Escape' && props.isOpen) {
                                props.onOpen();
                            }
                        }}
                        className="numeric ml-auto flex shrink-0 items-center rounded px-1.5 py-0.5 pl-2 text-[11px] text-ink-500 transition-colors hover:bg-abyss-700 hover:text-ink-200 touch:min-h-11"
                    >
                        {/* The figure alone where the row is narrow: with the
                            unit spelled out, the longest of them pushed the
                            delete button off the end of a card that clips. The
                            unit is in the name the button answers to, and on
                            the line that asks for it once the row is open. */}
                        <span className="@md:hidden">{contract.priceBucketSize}</span>
                        <span className="hidden @md:inline">
                            {props.translate('settings.perRow', { value: contract.priceBucketSize })}
                        </span>
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
                        className="grid size-7 shrink-0 place-items-center rounded text-ink-500 transition-colors hover:bg-abyss-700 hover:text-ask touch:size-11"
                    >
                        <Trash2 size={13} />
                    </button>
                </div>

                {props.isOpen && grids.length > 0 && (
                    <div className="border-t border-hairline/40 bg-abyss-900/40 px-3 py-2">
                        <div className="flex flex-wrap items-center gap-1 touch:gap-2">
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
                className={`${LIST_ROW_CLASSES} gap-3 transition-colors hover:bg-abyss-700 disabled:hover:bg-transparent`}
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
                <div className="flex flex-wrap items-center gap-1 border-t border-hairline/40 bg-abyss-900/40 px-3 py-2 touch:gap-2">
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
});
