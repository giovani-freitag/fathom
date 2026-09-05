import { CONTROL_CHIP_CLASSES, CONTROL_OFFERED_CLASSES, FLOATING_CARD_CLASSES, OVERLAY_CLASSES } from '../../ui/control-shell.ts';
import { Dialog } from 'radix-ui';
import { isAlreadyRecorded, offerGrids } from '../../markets/recordable.ts';
import { ListingCard, SearchField } from '../../ui/markets/listing-card.tsx';
import { narrowPairs, summariseQuotes } from '../../markets/pair-listing.ts';
import { type ReactElement, useEffect, useMemo, useState } from 'react';
import { RailHeading, RailRow } from '../../ui/markets/rail-row.tsx';
import type { RecordedContract } from '../../../shared/core/recording-control.ts';
import { SCROLLER_CLASSES } from '../../ui/control-shell.ts';
import type { Translate } from '../../i18n/translator.ts';
import { useMarkets } from '../../react/use-markets.ts';
import type { VenueInstrument } from '../../../shared/core/venue-connector.ts';

export interface RecordingCardProps {
    readonly isOpen: boolean;
    readonly onOpenChange: (isOpen: boolean) => void;
    /** The venues that publish a book, which are the only ones worth offering. */
    readonly venues: readonly string[];
    /** The venues that publish none, named so the absence is not a mystery. */
    readonly silent: readonly string[];
    readonly contracts: readonly RecordedContract[];
    readonly isSaving: boolean;
    readonly translate: Translate;
    readonly onRecord: (venue: string, instrument: VenueInstrument, priceBucketSize: number) => void;
}

/**
 * The pairs a venue offers to record, read the way every listing here is read.
 *
 * The same card as the contract picker rather than a list squeezed into the
 * panel beside the chart: a venue lists a thousand pairs, and a rail three
 * hundred pixels wide showing eight of them at a time is a scroll bar inside a
 * scroll bar. Search along the top, venues down the side, rows filling the rest.
 */
export function RecordingCard(props: RecordingCardProps): ReactElement {
    const { state, markets } = useMarkets();
    const [venue, setVenue] = useState(props.venues[0] ?? '');
    const [query, setQuery] = useState('');
    const [quote, setQuote] = useState('');
    const [chosen, setChosen] = useState<string | null>(null);

    const listing = state.listings[venue];
    // Only where nobody has asked yet. Asked again while one is in flight, each
    // pass aborts the last and starts another, and the listing never lands.
    useEffect(() => {
        if (props.isOpen && venue !== '' && (listing === undefined || listing.kind === 'unread')) {
            void markets.readListing(venue);
        }
    }, [listing, markets, props.isOpen, venue]);

    const listed = listing?.kind === 'read' || listing?.kind === 'reading' ? listing.instruments : null;
    const quotes = useMemo(() => (listed === null ? [] : summariseQuotes(listed)), [listed]);
    const narrowed = useMemo(
        () => (listed === null ? null : narrowPairs(listed, { query, quote })),
        [listed, query, quote],
    );

    return (
        <Dialog.Root open={props.isOpen} onOpenChange={props.onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className={OVERLAY_CLASSES} />
                <Dialog.Content
                    aria-label={props.translate('recording.pickerTitle')}
                    className={`${FLOATING_CARD_CLASSES} fixed left-1/2 top-1/2 z-50 flex`
                        + ' h-[min(34rem,calc(100dvh-3rem))] w-[min(52rem,calc(100vw-1.5rem))]'
                        + ' -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden !p-0'}
                >
                    <Dialog.Title className="sr-only">{props.translate('recording.pickerTitle')}</Dialog.Title>

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
                        {narrowed === null
                            ? (
                                <p className="min-h-0 flex-1 px-3 py-4 text-xs leading-snug text-ink-500">
                                    {props.translate('markets.reading')}
                                </p>
                            )
                            : (
                                <ul className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
                                    {narrowed.shown.map((instrument) => (
                                        <PairRow
                                            key={instrument.symbol}
                                            instrument={instrument}
                                            isOpen={chosen === instrument.symbol}
                                            isRecorded={isAlreadyRecorded(props.contracts, venue, instrument.symbol)}
                                            isSaving={props.isSaving}
                                            translate={props.translate}
                                            onOpen={() => {
                                                setChosen(chosen === instrument.symbol ? null : instrument.symbol);
                                            }}
                                            onRecord={(priceBucketSize) => {
                                                props.onRecord(venue, instrument, priceBucketSize);
                                                setChosen(null);
                                            }}
                                        />
                                    ))}
                                </ul>
                            )}
                    </ListingCard>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

interface PairRowProps {
    readonly instrument: VenueInstrument;
    /** True while this row is showing the grids it could be recorded on. */
    readonly isOpen: boolean;
    readonly isRecorded: boolean;
    readonly isSaving: boolean;
    readonly translate: Translate;
    readonly onOpen: () => void;
    readonly onRecord: (priceBucketSize: number) => void;
}

/**
 * One pair on offer, and the grid question it asks before it is taken.
 *
 * Asked here rather than assumed, because the grid cannot be changed later: a
 * contract recorded on one and re-recorded on another has two grids in one
 * history, and nothing downstream can tell which row belongs to which.
 */
function PairRow(props: PairRowProps): ReactElement {
    const grids = offerGrids(props.instrument);

    return (
        <li className="border-b border-hairline/40">
            <button
                type="button"
                disabled={props.isRecorded || grids.length === 0}
                onClick={props.onOpen}
                className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-abyss-700 disabled:hover:bg-transparent"
            >
                <span className="w-32 shrink-0 truncate text-sm font-semibold text-ink-100 sm:w-40">
                    {props.instrument.symbol}
                </span>
                <span className="hidden w-28 shrink-0 truncate text-xs text-ink-400 sm:inline">
                    {props.instrument.base}/{props.instrument.quote}
                </span>
                <span className="ml-auto shrink-0 pl-2 text-[11px] text-ink-500">
                    {props.isRecorded
                        ? props.translate('recording.alreadyOn')
                        : grids.length === 0
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
                        <button
                            key={grid.ticks}
                            type="button"
                            disabled={props.isSaving}
                            onClick={() => { props.onRecord(grid.priceBucketSize); }}
                            className={`${CONTROL_CHIP_CLASSES} h-7 justify-center px-2.5 ${CONTROL_OFFERED_CLASSES}`}
                        >
                            {props.translate('settings.perRow', { value: grid.priceBucketSize })}
                        </button>
                    ))}
                </div>
            )}
        </li>
    );
}
