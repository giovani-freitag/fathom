import { type ReactElement, useCallback, useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import {
    CONTROL_CHIP_CLASSES,
    CONTROL_CHOSEN_CLASSES,
    CONTROL_INPUT_CLASSES,
    CONTROL_OFFERED_CLASSES,
    PANEL_TITLE_CLASSES,
} from '../control-shell.ts';
import { FAVOURITES_ID, findListsHolding, type WatchedPair } from '../../../shared/core/watch-lists.ts';
import { MarketsRail, type Showing } from './markets-rail.tsx';
import { nameOf } from '../../markets/list-names.ts';
import { narrowPairs, summariseQuotes } from '../../markets/pair-listing.ts';
import { PairTable, type PairRow } from './pair-table.tsx';
import { Dialog } from 'radix-ui';
import type { Listing } from '../../core/markets-controller.ts';
import type { Translate } from '../../i18n/translator.ts';
import { readFactsFor } from '../../../shared/venues/venue-registry.ts';
import { useChartSlice } from '../../react/use-chart-state.ts';
import { useMarkets } from '../../react/use-markets.ts';
import { useTranslate } from '../../react/use-appearance.ts';

/** What is known about a venue nobody has asked about yet. */
const UNREAD: Listing = { kind: 'unread' };

interface MarketsDialogProps {
    readonly isOpen: boolean;
    readonly onOpenChange: (isOpen: boolean) => void;
    /** Puts a pair on the chart. */
    readonly onOpen: (pair: WatchedPair) => void;
    /** Which pair the chart is showing, so the table can say which. */
    readonly open: WatchedPair | null;
    /** Opens the editor, where a connector is written like any other addon. */
    readonly onWriteConnector?: (() => void) | undefined;
}

/**
 * The contracts, on a card large enough to read one.
 *
 * A dialog rather than a dropdown, because what a reader came here to do is
 * read a listing: a venue publishes over a thousand pairs, and a column three
 * hundred pixels wide showing eight of them at a time is a scroll bar with a
 * chart behind it.
 *
 * The shape is the one every venue's own interface settled on — targets down
 * one side, a search and a row of quote chips along the top, and the listing
 * itself filling the rest.
 */
export function MarketsDialog({
    isOpen,
    onOpenChange,
    onOpen,
    open,
    onWriteConnector,
}: MarketsDialogProps): ReactElement {
    const translate = useTranslate();
    const { state, markets } = useMarkets();
    const [showing, setShowing] = useState<Showing>({ kind: 'list' });
    const [query, setQuery] = useState('');
    const [quote, setQuote] = useState('');

    // Selected as the array the store already holds and turned into a set here.
    // A selector that builds the set is a new set on every read, and the store
    // compares what it read by identity.
    const instruments = useChartSlice((chart) => chart.instruments);
    const recorded = useMemo(
        () => new Set(instruments.map((one) => `${one.venue}/${one.instrumentSymbol}`)),
        [instruments],
    );

    // Only what the reader installed. The venue this build ships against is not
    // theirs to take away, and offering to would be offering to break the chart.
    const brought = useMemo(
        () => new Set(state.installed.map((one) => one.id)),
        [state.installed],
    );
    const openList = state.lists.find((list) => list.id === state.openListId) ?? state.lists[0];
    const listName = openList === undefined ? '' : nameOf(openList, translate);
    const listing: Listing = useMemo(
        () => (showing.kind === 'venue' ? state.listings[showing.venue] ?? UNREAD : UNREAD),
        [showing, state.listings],
    );

    // Asked for the moment a venue is shown rather than on a press of its own:
    // a reader who picked a venue is already asking what there is to pick.
    useEffect(() => {
        if (showing.kind === 'venue' && listing.kind === 'unread') {
            void markets.readListing(showing.venue);
        }
    }, [listing.kind, markets, showing]);

    // Two different answers, because a reader who reads the first one for the
    // second goes looking for a broken recording instead of for the `null` their
    // own connector declared.
    const sayWhyNot = useCallback((pair: WatchedPair): string => (
        readFactsFor(pair.venue).size === 0
            ? translate('markets.nothingToDraw')
            : translate('markets.notRecorded')
    ), [translate]);

    const quotes = useMemo(
        () => (listing.kind === 'read' ? summariseQuotes(listing.instruments) : []),
        [listing],
    );
    const narrowed = useMemo(
        () => (listing.kind === 'read' ? narrowPairs(listing.instruments, { query, quote }) : null),
        [listing, query, quote],
    );

    const rows: readonly PairRow[] = useMemo(() => {
        if (showing.kind === 'list') {
            return (openList?.pairs ?? []).map((pair) => {
                const isOpenable = recorded.has(`${pair.venue}/${pair.symbol}`);
                return {
                    pair,
                    base: '',
                    quote: '',
                    isKept: true,
                    isOpenable,
                    whyNot: sayWhyNot(pair),
                    // On a list, what a reader wants to know is why the one they
                    // kept will not open.
                    note: isOpenable ? '' : sayWhyNot(pair),
                };
            }).filter((row) => matchesQuery(row.pair.symbol, query));
        }

        return (narrowed?.shown ?? []).map((instrument) => {
            const pair = { venue: showing.venue, symbol: instrument.symbol };
            const isOpenable = recorded.has(`${pair.venue}/${pair.symbol}`);
            return {
                pair,
                base: instrument.base,
                quote: instrument.quote,
                isKept: findListsHolding(state.lists, pair).includes(openList?.id ?? FAVOURITES_ID),
                isOpenable,
                whyNot: sayWhyNot(pair),
                // On a venue's own listing the reason is true of almost every
                // row, and a column that repeats nine hundred times says
                // nothing. What is rare here is the handful this chart holds.
                note: markNote(instrument.isTrading, isOpenable, translate),
            };
        });
    }, [showing, openList, recorded, sayWhyNot, narrowed, state.lists, query, translate]);

    return (
        <Dialog.Root open={isOpen} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" />
                <Dialog.Content
                    aria-describedby={undefined}
                    className="fixed inset-0 z-50 flex flex-col border-hairline bg-abyss-850 shadow-2xl shadow-black/80 sm:inset-auto sm:left-1/2 sm:top-1/2 sm:h-[min(38rem,86vh)] sm:w-[min(60rem,94vw)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:border"
                >
                    <header className="flex shrink-0 items-center gap-3 border-b border-hairline px-3 py-2.5">
                        <Dialog.Title className={`${PANEL_TITLE_CLASSES} shrink-0`}>
                            {translate('markets.title')}
                        </Dialog.Title>
                        <div className="relative min-w-0 flex-1">
                            <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-ink-500" />
                            <input
                                autoFocus
                                type="search"
                                name="pairSearch"
                                aria-label={translate('markets.searchPairs')}
                                placeholder={translate('markets.searchPairs')}
                                value={query}
                                onChange={(event) => { setQuery(event.target.value); }}
                                className={`${CONTROL_INPUT_CLASSES} h-9 pl-8 pr-2`}
                            />
                        </div>
                        <Dialog.Close
                            aria-label={translate('markets.close')}
                            className="grid size-9 shrink-0 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-abyss-700 hover:text-ink-100"
                        >
                            <X className="size-4" />
                        </Dialog.Close>
                    </header>

                    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
                        <MarketsRail
                            lists={state.lists}
                            venues={state.venues}
                            openListId={openList?.id ?? FAVOURITES_ID}
                            showing={showing}
                            translate={translate}
                            onOpenList={(listId) => { markets.openList(listId); setShowing({ kind: 'list' }); }}
                            onBrowse={(venue) => { setShowing({ kind: 'venue', venue }); setQuote(''); }}
                            onAddList={(name) => { markets.addList(name); setShowing({ kind: 'list' }); }}
                            onRemoveList={(listId) => { markets.removeList(listId); }}
                            onRemoveVenue={(venue) => { markets.removeConnector(venue); setShowing({ kind: 'list' }); }}
                            broughtVenues={brought}
                            onWriteConnector={onWriteConnector}
                        />

                        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
                            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-hairline px-3 py-2">
                                {/* Where the next star lands, said out loud. A
                                    reader browsing a venue cannot see which list
                                    is selected without it. */}
                                <span className="text-[11px] text-ink-500">
                                    {translate('markets.savingTo', { list: listName })}
                                </span>
                                {quotes.length > 0 && (
                                    <div className="ml-auto flex flex-wrap gap-1">
                                        <QuoteChip said={translate('markets.allQuotes')} isOn={quote === ''} onPress={() => { setQuote(''); }} />
                                        {quotes.map((one) => (
                                            <QuoteChip key={one} said={one} isOn={quote === one} onPress={() => { setQuote(one); }} />
                                        ))}
                                    </div>
                                )}
                            </div>

                            <Body
                                showing={showing}
                                listing={listing}
                                rowCount={rows.length}
                                translate={translate}
                                onRetry={() => {
                                    if (showing.kind === 'venue') {
                                        void markets.readListing(showing.venue);
                                    }
                                }}
                            >
                                <PairTable
                                    rows={rows}
                                    hasVenueColumn={showing.kind === 'list'}
                                    open={open}
                                    listName={listName}
                                    translate={translate}
                                    onOpen={(pair) => { onOpen(pair); onOpenChange(false); }}
                                    onKeep={(pair, isKept) => {
                                        const listId = openList?.id ?? FAVOURITES_ID;
                                        if (isKept) {
                                            markets.removePair(listId, pair);
                                        } else {
                                            markets.addPair(listId, pair);
                                        }
                                    }}
                                />
                            </Body>

                            {narrowed !== null && narrowed.matched > narrowed.shown.length && (
                                <p className="shrink-0 border-t border-hairline px-3 py-2 text-[11px] text-ink-500">
                                    {translate('markets.shownOf', {
                                        shown: String(narrowed.shown.length),
                                        matched: String(narrowed.matched),
                                    })}
                                </p>
                            )}
                        </section>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

interface BodyProps {
    readonly showing: Showing;
    readonly listing: Listing;
    readonly rowCount: number;
    readonly translate: Translate;
    readonly onRetry: () => void;
    readonly children: ReactElement;
}

/**
 * The table, or the one sentence that stands in for it.
 *
 * Every state the listing can be in answers here rather than inside the table,
 * so the table only ever draws rows.
 */
function Body({ showing, listing, rowCount, translate, onRetry, children }: BodyProps): ReactElement {
    if (showing.kind === 'venue' && (listing.kind === 'unread' || listing.kind === 'reading')) {
        return <Said said={translate('markets.reading')} />;
    }

    if (showing.kind === 'venue' && listing.kind === 'refused') {
        return (
            <div className="flex min-h-0 flex-1 flex-col items-start gap-3 px-3 py-4">
                <p className="text-xs leading-snug text-amber">
                    {listing.said ?? translate('markets.noConnector')}
                </p>
                <button
                    type="button"
                    onClick={onRetry}
                    className={`${CONTROL_CHIP_CLASSES} h-8 justify-center ${CONTROL_OFFERED_CLASSES}`}
                >
                    {translate('markets.retry')}
                </button>
            </div>
        );
    }

    if (rowCount === 0) {
        return (
            <Said said={translate(showing.kind === 'list' ? 'markets.emptyList' : 'markets.noPairs')} />
        );
    }

    return children;
}

/** One sentence where the table would have been. */
function Said({ said }: { readonly said: string }): ReactElement {
    return (
        <p className="min-h-0 flex-1 px-3 py-4 text-xs leading-snug text-ink-500">{said}</p>
    );
}

interface QuoteChipProps {
    readonly said: string;
    readonly isOn: boolean;
    readonly onPress: () => void;
}

/** One quote currency to narrow the listing by. */
function QuoteChip({ said, isOn, onPress }: QuoteChipProps): ReactElement {
    return (
        <button
            type="button"
            aria-pressed={isOn}
            onClick={onPress}
            className={`${CONTROL_CHIP_CLASSES} h-7 justify-center px-2.5 ${
                isOn ? CONTROL_CHOSEN_CLASSES : CONTROL_OFFERED_CLASSES
            }`}
        >
            {said}
        </button>
    );
}

/**
 * The word at the end of a venue's row: what is rare about it, or nothing.
 */
function markNote(isTrading: boolean, isOpenable: boolean, translate: Translate): string {
    if (!isTrading) {
        return translate('markets.halted');
    }
    return isOpenable ? translate('markets.recorded') : '';
}

/**
 * Whether a kept pair answers what was typed.
 *
 * Only the symbol, because a list holds pairs rather than a venue's listing and
 * has no assets of its own to match against.
 */
function matchesQuery(symbol: string, query: string): boolean {
    const wanted = query.trim().toUpperCase();
    return wanted === '' || symbol.toUpperCase().includes(wanted);
}
