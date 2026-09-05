import { type ReactElement, useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Search, Star, Trash2 } from 'lucide-react';
import {
    CONTROL_CHIP_CLASSES,
    CONTROL_CHOSEN_CLASSES,
    CONTROL_INPUT_CLASSES,
    CONTROL_OFFERED_CLASSES,
    PANEL_ADD_CLASSES,
} from '../control-shell.ts';
import { FAVOURITES_ID, findListsHolding, type WatchedPair, type WatchList } from '../../../shared/core/watch-lists.ts';
import { ICON_SIZE_PX, LAYER_BUTTON_CLASSES } from '../indicators/layer-list.tsx';
import type { Listing } from '../../core/markets-controller.ts';
import { readFactsFor } from '../../../shared/venues/venue-registry.ts';
import { PanelSection } from '../panel-section.tsx';
import type { Translate } from '../../i18n/translator.ts';
import { useMarkets } from '../../react/use-markets.ts';
import { useChartSlice } from '../../react/use-chart-state.ts';
import { useTranslate } from '../../react/use-appearance.ts';
import type { VenueInstrument } from '../../../shared/core/venue-connector.ts';

/** As many pairs as are worth putting on screen before a reader narrows them. */
const PAIRS_SHOWN = 60;

interface MarketsPanelProps {
    /** Puts a pair on the chart. */
    readonly onOpen: (pair: WatchedPair) => void;
    /** Which pair the chart is showing, so the panel can say which. */
    readonly open: WatchedPair | null;
    /** Opens the editor, where a connector is written like any other addon. */
    readonly onWriteConnector?: (() => void) | undefined;
}

/**
 * The contracts a reader keeps, and where they come from.
 *
 * Two halves of one question, in one panel: the top is what they already chose
 * and the bottom is everything they could choose. Split into two panels, a
 * reader who wanted BTC on a second venue had to find out that adding it and
 * opening it were different places.
 */
export function MarketsPanel({ onOpen, open, onWriteConnector }: MarketsPanelProps): ReactElement {
    const translate = useTranslate();
    const { state, markets } = useMarkets();
    // Selected as the array the store already holds and turned into a set here.
    // A selector that builds the set is a new set on every read, and the store
    // compares what it read by identity: the panel re-rendered until React
    // stopped it.
    const instruments = useChartSlice((chart) => chart.instruments);
    // What the chart can actually open. A list holds pairs a reader means to
    // watch, which is not the same set as the ones being recorded, and a row
    // that silently does nothing when pressed is worse than one that says why.
    const recorded = useMemo(
        () => new Set(instruments.map((one) => `${one.venue}/${one.instrumentSymbol}`)),
        [instruments],
    );
    const [query, setQuery] = useState('');
    const [isNaming, setIsNaming] = useState(false);

    // Two different answers, because a reader who reads the first one for the
    // second goes looking for a broken recording instead of for the `null` their
    // own connector declared.
    const sayWhyNot = useCallback((pair: WatchedPair): string => (
        readFactsFor(pair.venue).size === 0
            ? translate('markets.nothingToDraw')
            : translate('markets.notRecorded')
    ), [translate]);

    const openList = state.lists.find((list) => list.id === state.openListId) ?? state.lists[0];
    const listing = state.listings[state.browsingVenue] ?? { kind: 'unread' as const };

    // Asked for the moment the panel is opened rather than on a press of its
    // own: a reader opening the contract picker is already asking what there is
    // to pick. Only while nothing is known, so closing and reopening the panel
    // does not ask the venue again.
    useEffect(() => {
        if (listing.kind === 'unread' && state.browsingVenue !== '') {
            void markets.readListing(state.browsingVenue);
        }
    }, [listing.kind, markets, state.browsingVenue]);

    return (
        <div className="w-80">
            <PanelSection isDivided={false} title={translate('markets.lists')}>
                <div className="flex flex-wrap gap-1.5">
                    {state.lists.map((list) => (
                        <button
                            key={list.id}
                            type="button"
                            aria-pressed={list.id === openList?.id}
                            onClick={() => { markets.openList(list.id); }}
                            className={`${CONTROL_CHIP_CLASSES} h-8 ${
                                list.id === openList?.id ? CONTROL_CHOSEN_CLASSES : CONTROL_OFFERED_CLASSES
                            }`}
                        >
                            {nameOf(list, translate)}
                            {list.pairs.length > 0 && (
                                <span className="rounded-full bg-current/15 px-1.5 text-[10px] font-semibold">
                                    {list.pairs.length}
                                </span>
                            )}
                        </button>
                    ))}

                    {isNaming
                        ? (
                            <NameAList
                                translate={translate}
                                onName={(name) => { markets.addList(name); setIsNaming(false); }}
                                onGiveUp={() => { setIsNaming(false); }}
                            />
                        )
                        : (
                            <button
                                type="button"
                                onClick={() => { setIsNaming(true); }}
                                className={`${PANEL_ADD_CLASSES} h-8`}
                            >
                                <Plus className="size-3.5" />
                                {translate('markets.newList')}
                            </button>
                        )}
                </div>

                {openList !== undefined && (
                    <KeptPairs
                        list={openList}
                        open={open}
                        recorded={recorded}
                        sayWhyNot={sayWhyNot}
                        translate={translate}
                        onOpen={onOpen}
                        onDrop={(pair) => { markets.removePair(openList.id, pair); }}
                        onRemoveList={openList.id === FAVOURITES_ID
                            ? undefined
                            : () => { markets.removeList(openList.id); }}
                    />
                )}
            </PanelSection>

            <PanelSection title={translate('markets.venue')}>
                <div className="flex flex-wrap gap-1.5">
                    {state.venues.map((venue) => (
                        <button
                            key={venue}
                            type="button"
                            aria-pressed={venue === state.browsingVenue}
                            onClick={() => { markets.browse(venue); }}
                            className={`${CONTROL_CHIP_CLASSES} h-8 ${
                                venue === state.browsingVenue ? CONTROL_CHOSEN_CLASSES : CONTROL_OFFERED_CLASSES
                            }`}
                        >
                            {venue}
                        </button>
                    ))}

                    {onWriteConnector !== undefined && (
                        <button type="button" onClick={onWriteConnector} className={`${PANEL_ADD_CLASSES} h-8`}>
                            <Plus className="size-3.5" />
                            {translate('markets.addVenue')}
                        </button>
                    )}
                </div>

                <div className="relative">
                    <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-ink-500" />
                    <input
                        type="search"
                        name="pairSearch"
                        aria-label={translate('markets.searchPairs')}
                        placeholder={translate('markets.searchPairs')}
                        value={query}
                        onChange={(event) => { setQuery(event.target.value); }}
                        className={`${CONTROL_INPUT_CLASSES} pl-8 pr-2`}
                    />
                </div>

                <VenueListing
                    listing={listing}
                    venue={state.browsingVenue}
                    query={query}
                    lists={state.lists}
                    openListId={openList?.id ?? FAVOURITES_ID}
                    openListName={openList === undefined ? '' : nameOf(openList, translate)}
                    translate={translate}
                    onRetry={() => { void markets.readListing(state.browsingVenue); }}
                    onKeep={(pair, isHeld) => {
                        const listId = openList?.id ?? FAVOURITES_ID;
                        if (isHeld) {
                            markets.removePair(listId, pair);
                        } else {
                            markets.addPair(listId, pair);
                        }
                    }}
                />
            </PanelSection>
        </div>
    );
}

interface KeptPairsProps {
    readonly list: WatchList;
    readonly open: WatchedPair | null;
    /** Which pairs have a recording behind them, keyed venue and symbol. */
    readonly recorded: ReadonlySet<string>;
    /** Why one cannot be opened, which is not the same answer for every venue. */
    readonly sayWhyNot: (pair: WatchedPair) => string;
    readonly translate: Translate;
    readonly onOpen: (pair: WatchedPair) => void;
    readonly onDrop: (pair: WatchedPair) => void;
    readonly onRemoveList?: (() => void) | undefined;
}

/** What is in the open list, each one a way onto the chart. */
function KeptPairs({
    list,
    open,
    recorded,
    sayWhyNot,
    translate,
    onOpen,
    onDrop,
    onRemoveList,
}: KeptPairsProps): ReactElement {
    if (list.pairs.length === 0) {
        return <p className="px-1 py-2 text-xs leading-snug text-ink-500">{translate('markets.emptyList')}</p>;
    }

    return (
        <>
            <ul className="max-h-56 overflow-y-auto">
                {list.pairs.map((pair) => (
                    <li key={`${pair.venue}/${pair.symbol}`} className="flex items-stretch gap-1">
                        <button
                            type="button"
                            disabled={!recorded.has(`${pair.venue}/${pair.symbol}`)}
                            onClick={() => { onOpen(pair); }}
                            aria-current={open !== null && open.venue === pair.venue && open.symbol === pair.symbol}
                            title={recorded.has(`${pair.venue}/${pair.symbol}`) ? undefined : sayWhyNot(pair)}
                            className={`flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-abyss-700 disabled:hover:bg-transparent ${
                                open !== null && open.venue === pair.venue && open.symbol === pair.symbol
                                    ? 'text-phosphor'
                                    : 'text-ink-100'
                            }`}
                        >
                            <span className="truncate font-semibold">{pair.symbol}</span>
                            {/* Said on every row rather than only on the ones
                                from elsewhere: two rows reading BTCUSDT with the
                                venue on one of them looks like a mistake. */}
                            <span className="truncate text-xs text-ink-500">{pair.venue}</span>
                            {!recorded.has(`${pair.venue}/${pair.symbol}`) && (
                                <span className="ml-auto shrink-0 text-[10px] text-ink-500">
                                    {sayWhyNot(pair)}
                                </span>
                            )}
                        </button>
                        <button
                            type="button"
                            aria-label={translate('markets.removeFrom', {
                                symbol: pair.symbol,
                                list: nameOf(list, translate),
                            })}
                            onClick={() => { onDrop(pair); }}
                            className={LAYER_BUTTON_CLASSES}
                        >
                            <Star size={ICON_SIZE_PX} className="fill-current text-phosphor" />
                        </button>
                    </li>
                ))}
            </ul>

            {onRemoveList !== undefined && (
                <button
                    type="button"
                    onClick={onRemoveList}
                    className="flex items-center gap-1.5 self-start rounded px-2 py-1 text-xs text-ink-500 transition-colors hover:bg-abyss-700 hover:text-amber"
                >
                    <Trash2 className="size-3.5" />
                    {translate('markets.removeList')}
                </button>
            )}
        </>
    );
}

interface VenueListingProps {
    readonly listing: Listing;
    readonly venue: string;
    readonly query: string;
    readonly lists: readonly WatchList[];
    readonly openListId: string;
    readonly openListName: string;
    readonly translate: Translate;
    readonly onRetry: () => void;
    readonly onKeep: (pair: WatchedPair, isHeld: boolean) => void;
}

/** Everything one venue trades, or why that could not be found out. */
function VenueListing(props: VenueListingProps): ReactElement {
    const { listing, translate } = props;

    const shown = useMemo(
        () => (listing.kind === 'read' ? findPairs(listing.instruments, props.query) : []),
        [listing, props.query],
    );

    if (listing.kind === 'reading' || listing.kind === 'unread') {
        return <p className="px-1 py-2 text-xs text-ink-500">{translate('markets.reading')}</p>;
    }

    if (listing.kind === 'refused') {
        return (
            <div className="space-y-2 px-1 py-2">
                <p className="text-xs leading-snug text-amber">
                    {listing.said ?? translate('markets.noConnector')}
                </p>
                <button type="button" onClick={props.onRetry} className={`${PANEL_ADD_CLASSES} h-8`}>
                    {translate('markets.retry')}
                </button>
            </div>
        );
    }

    if (shown.length === 0) {
        return <p className="px-1 py-2 text-xs text-ink-500">{translate('markets.noPairs')}</p>;
    }

    return (
        <ul className="max-h-64 overflow-y-auto">
            {shown.map((instrument) => {
                const pair = { venue: props.venue, symbol: instrument.symbol };
                const holding = findListsHolding(props.lists, pair);
                const isHeld = holding.includes(props.openListId);

                return (
                    <li key={instrument.symbol}>
                        <button
                            type="button"
                            aria-pressed={isHeld}
                            aria-label={translate(isHeld ? 'markets.removeFrom' : 'markets.addTo', {
                                symbol: instrument.symbol,
                                list: props.openListName,
                            })}
                            onClick={() => { props.onKeep(pair, isHeld); }}
                            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-abyss-700"
                        >
                            <Star
                                size={ICON_SIZE_PX}
                                className={isHeld ? 'shrink-0 fill-current text-phosphor' : 'shrink-0 text-ink-500'}
                            />
                            <span className="truncate text-sm font-semibold text-ink-100">{instrument.symbol}</span>
                            <span className="truncate text-xs text-ink-500">
                                {instrument.base}/{instrument.quote}
                            </span>
                            {/* A listing that has stopped trading still has a
                                history worth opening, so it is shown and marked
                                rather than left out of the list entirely. */}
                            {!instrument.isTrading && <span className="ml-auto shrink-0 text-[10px] text-amber">✕</span>}
                        </button>
                    </li>
                );
            })}
        </ul>
    );
}

interface NameAListProps {
    readonly translate: Translate;
    readonly onName: (name: string) => void;
    readonly onGiveUp: () => void;
}

/** The field a new list is named in, which replaces the button that opened it. */
function NameAList({ translate, onName, onGiveUp }: NameAListProps): ReactElement {
    const [name, setName] = useState('');

    return (
        <input
            autoFocus
            type="text"
            name="listName"
            aria-label={translate('markets.listName')}
            placeholder={translate('markets.listName')}
            value={name}
            onChange={(event) => { setName(event.target.value); }}
            onBlur={() => { onName(name); }}
            onKeyDown={(event) => {
                if (event.key === 'Enter') {
                    onName(name);
                }
                if (event.key === 'Escape') {
                    onGiveUp();
                }
            }}
            className={`${CONTROL_INPUT_CLASSES} h-8 w-32 px-2`}
        />
    );
}

/**
 * What a list is called, which the interface names for the first one.
 *
 * Named here rather than stored, because a name written into storage in one
 * language stays in that language after the reader changes it.
 */
function nameOf(list: WatchList, translate: Translate): string {
    return list.name === '' ? translate('markets.favourites') : list.name;
}

/**
 * The pairs whose symbol or assets answer what was typed.
 *
 * Cut to what is worth putting on screen: a venue lists hundreds, and a reader
 * who has not typed anything is scrolling rather than looking for one.
 */
function findPairs(
    instruments: readonly VenueInstrument[],
    query: string,
): readonly VenueInstrument[] {
    const wanted = query.trim().toUpperCase();
    if (wanted === '') {
        return instruments.slice(0, PAIRS_SHOWN);
    }

    return instruments
        .filter((instrument) => instrument.symbol.toUpperCase().includes(wanted)
            || instrument.base.toUpperCase().includes(wanted)
            || instrument.quote.toUpperCase().includes(wanted))
        .slice(0, PAIRS_SHOWN);
}
