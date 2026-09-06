import { type ReactElement, useCallback, useEffect, useMemo, useState } from 'react';
import { ListingCard, RailBar, SearchField } from './listing-card.tsx';
import { FAVOURITES_ID, findTagsHolding, type MarketPair } from '../../../shared/core/pair-tags.ts';
import { FIRST_VENUE } from '../../../shared/core/recording-control.ts';
import { ArrowLeft, ChevronRight, Plus, TagPlus } from 'lucide-react';
import {
    CONTROL_CHIP_CLASSES,
    CONTROL_CHOSEN_CLASSES,
    CONTROL_OFFERED_CLASSES,
    CONTROL_BUTTON_CLASSES,
    CONTROL_RESTING_CLASSES,
    PANEL_ADD_CLASSES,
    SCROLLER_CLASSES,
} from '../control-shell.ts';
import { ListingBody, ListingFooting, QuoteFilter, Said } from './listing-body.tsx';
import { MarketsRail, type Showing, TagNameField } from './markets-rail.tsx';
import { readPickerVariant } from '../../react/use-picker-variant.ts';
import { Select } from '../select.tsx';
import { NewTagCard } from './new-tag-card.tsx';
import { SourceList, type SourceKind, SourceTabs } from './source-list.tsx';
import { labelOf } from '../../markets/tag-names.ts';
import { gatherLibrary, type LibraryFilter, narrowLibrary } from '../../markets/library.ts';
import { narrowPairs, searchAcross, summariseQuotes } from '../../markets/pair-listing.ts';
import { PairTable, type PairRow } from './pair-table.tsx';
import { TagSwatch } from './tag-swatch.tsx';
import { VenueMark } from './venue-mark.tsx';
import type { Listing } from '../../core/markets-controller.ts';
import type { VenueInstrument } from '../../../shared/core/venue-connector.ts';
import type { Translate } from '../../i18n/translator.ts';
import { readFactsFor } from '../../../shared/venues/venue-registry.ts';
import { useChartSlice } from '../../react/use-chart-state.ts';
import { useMarkets } from '../../react/use-markets.ts';
import { useTranslate } from '../../react/use-appearance.ts';
import { useIsViewportAtLeast } from '../../react/use-viewport-width.ts';

/** Which chip a filter is, for comparing one against another. */
function chipKey(filter: LibraryFilter): string {
    return filter.kind === 'tag' ? filter.tagId : filter.kind;
}

/** What is known about a venue nobody has asked about yet. */
const UNREAD: Listing = { kind: 'unread' };

/**
 * How long typing settles before the venue is asked about it.
 *
 * Long enough that a word is one question rather than five, short enough that
 * the answer arrives while the reader is still looking at what they typed.
 */
const TYPING_SETTLES_MS = 250;

interface MarketsPanelProps {
    /** Closes the card the panel is in, once a pair has been picked. */
    readonly onClose: () => void;
    /** Puts a pair on the chart. */
    readonly onOpen: (pair: MarketPair) => void;
    /** Which pair the chart is showing, so the table can say which. */
    readonly open: MarketPair | null;
    /** Opens the editor, where a connector is written like any other addon. */
    readonly onWriteConnector?: (() => void) | undefined;
}

/**
 * The contracts, on a card large enough to read a listing on.
 *
 * The same dropdown every other question on this bar opens, given the room the
 * answer needs: a venue publishes over a thousand pairs, and a column three
 * hundred pixels wide showing eight at a time is a scroll bar with a chart
 * behind it.
 *
 * Inside, the shape is the one every venue's own interface settled on — targets
 * down one side, a search and a row of quote chips along the top, and the
 * listing itself filling the rest.
 */
export function MarketsPanel({
    onClose,
    onOpen,
    open,
    onWriteConnector,
}: MarketsPanelProps): ReactElement {
    const translate = useTranslate();
    // On a phone the select above says what is being looked at, so the banner
    // saying it again is the same answer twice on the screen with least room
    // for it.
    const isWide = useIsViewportAtLeast('lg');
    const { state, markets } = useMarkets();
    // The shape that searches everywhere opens on a catalogue rather than on a
    // tag: a reader arriving for the first time has no tags, and a card that
    // opens on an empty one has answered nothing and offers nowhere obvious to
    // go.
    const [showing, setShowing] = useState<Showing>(
        ['search', 'selects'].includes(readPickerVariant(globalThis.location.search))
            ? { kind: 'venue', venue: FIRST_VENUE }
            : { kind: 'tag' },
    );
    const [query, setQuery] = useState('');
    // Which body the sheet is showing on a phone: the pairs, or one kind of
    // source. Two shapes of the same question are behind `?picker=`, so they
    // can be put in front of readers rather than argued about.
    const variant = readPickerVariant(globalThis.location.search);
    const [openSource, setOpenSource] = useState<SourceKind | null>(null);
    const [chip, setChip] = useState<LibraryFilter>({ kind: 'all' });
    const [isNamingTag, setIsNamingTag] = useState(false);
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
    const openTag = state.tags.find((tag) => tag.id === state.openTagId) ?? state.tags[0];
    const tagLabel = openTag === undefined ? '' : labelOf(openTag, translate);
    const tagColour = openTag?.colour ?? 'phosphor';
    const listing: Listing = useMemo(
        () => (showing.kind === 'venue' ? state.listings[showing.venue] ?? UNREAD : UNREAD),
        [showing, state.listings],
    );

    // The library never browses a catalogue, so nothing would have read one —
    // and a search that falls through to the venues would fall through to
    // nothing. One listing, the venue the chart is on, read once when the sheet
    // is open and never again.
    useEffect(() => {
        if (variant === 'library' && state.listings[state.browsingVenue] === undefined) {
            void markets.readListing(state.browsingVenue);
        }
    }, [variant, markets, state.browsingVenue, state.listings]);

    // Asked for the moment a venue is shown rather than on a press of its own:
    // a reader who picked a venue is already asking what there is to pick.
    useEffect(() => {
        if (showing.kind === 'venue' && listing.kind === 'unread') {
            void markets.readListing(showing.venue);
        }
    }, [listing.kind, markets, showing]);

    // Asked of the venue itself, where it answers such questions. The listing
    // may still be arriving, and searching the part that happens to have landed
    // is how a reader concludes a pair is not there.
    useEffect(() => {
        if (showing.kind !== 'venue') {
            return undefined;
        }

        const venue = showing.venue;
        const asking = setTimeout(() => { void markets.searchListing(venue, query); }, TYPING_SETTLES_MS);
        return () => { clearTimeout(asking); };
    }, [markets, query, showing]);

    // Two different answers, because a reader who reads the first one for the
    // second goes looking for a broken recording instead of for the `null` their
    // own connector declared.
    const sayWhyNot = useCallback((pair: MarketPair): string => (
        readFactsFor(pair.venue).size === 0
            ? translate('markets.nothingToDraw')
            : translate('markets.notRecorded')
    ), [translate]);

    // The same answer in two words, for the column at the end of a row. The
    // whole sentence is on the row's own label and its tooltip, where there is
    // room for it.
    const noteWhyNot = useCallback((pair: MarketPair): string => (
        readFactsFor(pair.venue).size === 0
            ? translate('markets.noteNothingToDraw')
            : translate('markets.noteNotRecorded')
    ), [translate]);

    // Pointing the listing somewhere else clears what was typed at the last
    // one. A search reads as a search of everything, and carried across it
    // quietly answers a question about one venue with another venue's rows —
    // or with none, and no sign of why.
    const show = useCallback((wanted: Showing) => {
        setShowing(wanted);
        setQuery('');
        setQuote('');
    }, []);

    // What has been read, whether or not the reading has finished.
    const listed = useMemo((): readonly VenueInstrument[] | null => {
        if (listing.kind === 'read') {
            return listing.instruments;
        }
        return listing.kind === 'reading' ? listing.instruments : null;
    }, [listing]);

    // The venue's own answer, where it gave one for what is typed now. Matched
    // on the term as well as the venue: an answer to the previous word is worse
    // than no answer at all.
    const answered = useMemo(() => {
        const search = state.search;
        return showing.kind === 'venue' && search !== null && search.venue === showing.venue
            && search.term === query.trim() && search.kind === 'read'
            ? search.instruments
            : null;
    }, [state.search, showing, query]);

    // What this venue is recording, which the row cut is not allowed to drop.
    const recordedHere = useMemo(() => new Set(
        showing.kind === 'venue'
            ? instruments.filter((one) => one.venue === showing.venue).map((one) => one.instrumentSymbol)
            : [],
    ), [instruments, showing]);

    // Every catalogue already in memory, for the shape that searches all of
    // them at once. Nothing is fetched to build this: a venue nobody opened has
    // no listing here, and the footing says which were covered.
    const readEverywhere = useMemo(() => Object.fromEntries(
        Object.entries(state.listings)
            .map(([venue, one]) => [venue, one.kind === 'read' || one.kind === 'reading' ? one.instruments : []])
            .filter(([, instruments]) => (instruments as readonly VenueInstrument[]).length > 0),
    ) as Readonly<Record<string, readonly VenueInstrument[]>>, [state.listings]);

    const everywhere = useMemo(
        // Both shapes that stop asking which venue: one searches the catalogues
        // instead of a venue, the other searches them under what the reader
        // already has.
        () => ((variant === 'search' || variant === 'library') && query.trim() !== ''
            ? searchAcross(readEverywhere, { query, quote })
            : null),
        [variant, readEverywhere, query, quote],
    );

    // What the reader already has a claim on, which is the list worth opening
    // on: four or five pairs rather than a catalogue of nine hundred.
    const library = useMemo(
        () => gatherLibrary(
            instruments.map((one) => ({ venue: one.venue, symbol: one.instrumentSymbol })),
            state.tags,
            open,
        ),
        [instruments, state.tags, open],
    );

    const quotes = useMemo(() => (listed === null ? [] : summariseQuotes(listed)), [listed]);
    const narrowed = useMemo(() => {
        if (answered !== null) {
            // Narrowed by the chip alone: the venue has already decided what
            // the typing matched, and matching it again with our own rule drops
            // the rows it read more generously than we would have.
            return narrowPairs(answered, { query: '', quote });
        }
        return listed === null ? null : narrowPairs(listed, { query, quote, keep: recordedHere });
    }, [answered, listed, query, quote, recordedHere]);

    // What a row is filed under, which its own first cell both shows and
    // changes. Read per row rather than per tag: a pair carries several, and
    // the row is where a reader is looking when they decide.
    const heldBy = useCallback((pair: MarketPair): ReadonlySet<string> => (
        new Set(findTagsHolding(state.tags, pair).map((tag) => tag.id))
    ), [state.tags]);

    const mine: readonly PairRow[] = useMemo(() => {
        const wanted = query.trim().toUpperCase();
        return narrowLibrary(library, chip)
            .filter((row) => wanted === '' || row.pair.symbol.toUpperCase().includes(wanted))
            .map((row) => ({
                pair: row.pair,
                base: '',
                quote: '',
                held: row.held,
                isOpenable: row.isRecorded,
                whyNot: sayWhyNot(row.pair),
                // The venue has a column of its own here, and the word worth
                // the end of the row is why this pair is in the list at all.
                note: row.isRecorded ? translate('markets.recorded') : '',
            }));
    }, [library, chip, query, sayWhyNot, translate]);

    const rows: readonly PairRow[] = useMemo(() => {
        if (everywhere !== null) {
            return everywhere.shown.map(({ venue, instrument }) => {
                const pair = { venue, symbol: instrument.symbol };
                const isOpenable = recorded.has(`${pair.venue}/${pair.symbol}`);
                return {
                    pair,
                    base: instrument.base,
                    quote: instrument.quote,
                    held: heldBy(pair),
                    isOpenable,
                    whyNot: sayWhyNot(pair),
                    // The venue, because the row is the only thing that can say
                    // which catalogue this came out of once the search stopped
                    // being about one of them.
                    note: venue,
                };
            });
        }

        if (showing.kind === 'tag') {
            return (openTag?.pairs ?? []).map((pair) => {
                const isOpenable = recorded.has(`${pair.venue}/${pair.symbol}`);
                return {
                    pair,
                    base: '',
                    quote: '',
                    held: heldBy(pair),
                    isOpenable,
                    whyNot: sayWhyNot(pair),
                    // Under a tag, what a reader wants to know is why the one
                    // they kept will not open.
                    note: isOpenable ? '' : noteWhyNot(pair),
                };
            }).filter((row) => matchesQuery(row.pair.symbol, query));
        }

        // The chips belong to the library, which is the only shape that filters a
        // catalogue by a tag. Applied everywhere, a tag made in the card stayed
        // on as a filter over every venue afterwards: the listing went on being
        // narrowed to the one pair that tag held, and a search for anything else
        // answered "nothing by that name on this venue".
        const held = variant === 'library' && chip.kind === 'tag'
            // Narrowed to this venue's half of the tag: a tag spans venues, and
            // the rows underneath are one venue's catalogue.
            ? new Set((state.tags.find((one) => one.id === chip.tagId)?.pairs ?? [])
                .filter((one) => one.venue === showing.venue)
                .map((one) => one.symbol))
            : null;

        return (narrowed?.shown ?? [])
            .filter((instrument) => held === null || held.has(instrument.symbol))
            .map((instrument) => {
                const pair = { venue: showing.venue, symbol: instrument.symbol };
                const isOpenable = recorded.has(`${pair.venue}/${pair.symbol}`);
                return {
                    pair,
                    base: instrument.base,
                    quote: instrument.quote,
                    held: heldBy(pair),
                    isOpenable,
                    whyNot: sayWhyNot(pair),
                    // On a venue's own listing the reason is true of almost every
                    // row, and a column that repeats nine hundred times says
                    // nothing. What is rare here is the handful this chart holds.
                    note: markNote(instrument.isTrading, isOpenable, translate),
                };
            });
    }, [everywhere, showing, openTag, recorded, sayWhyNot, noteWhyNot, heldBy, narrowed, query, translate,
        chip, state.tags, variant]);

    return (
        <ListingCard
            search={(
                <SearchField
                    hasFocus
                    label={translate('markets.searchPairs')}
                    value={query}
                    onChange={setQuery}
                />
            )}
            rail={isNamingTag && !isWide && variant === 'selects'
                // The card is a step of its own; the filters behind it belong to
                // the listing it stepped away from.
                ? undefined
                : !isWide && variant === 'selects'
                    ? (
                        <RailBar>
                            {/* One control for what is being looked at, and two
                                for making one more of each kind. The kinds are
                                unlike enough that one button for both would
                                have to ask which — and that is a question the
                                icons answer without being asked. */}
                            <Select
                                label={translate('markets.title')}
                                value={showing.kind === 'tag'
                                    ? `tag:${openTag?.id ?? FAVOURITES_ID}`
                                    : `venue:${showing.venue}`}
                                choices={[
                                    ...state.tags.map((one) => ({
                                        value: `tag:${one.id}`,
                                        label: labelOf(one, translate),
                                        detail: String(one.pairs.length),
                                        group: translate('markets.yourTags'),
                                        // The colour is how a reader picks a tag
                                        // out of a column of rows; it should be
                                        // how they pick it here too.
                                        icon: <TagSwatch colour={one.colour} className="size-2.5" />,
                                    })),
                                    ...state.venues.map((one) => ({
                                        value: `venue:${one}`,
                                        label: one,
                                        group: translate('markets.venues'),
                                        icon: <VenueMark venue={one} />,
                                    })),
                                ]}
                                onSelect={(picked) => {
                                    const [kind, ...rest] = picked.split(':');
                                    const named = rest.join(':');
                                    if (kind === 'tag') {
                                        markets.openTag(named);
                                        show({ kind: 'tag' });
                                        return;
                                    }
                                    show({ kind: 'venue', venue: named });
                                }}
                            />

                            <button
                                type="button"
                                aria-label={translate('markets.newTag')}
                                title={translate('markets.newTag')}
                                onClick={() => { setIsNamingTag(true); }}
                                className={`${CONTROL_BUTTON_CLASSES} shrink-0 border border-hairline bg-abyss-800/80 ${CONTROL_RESTING_CLASSES}`}
                            >
                                <TagPlus className="size-4" />
                            </button>

                            {/* No way to bring a venue in from here. Adding one
                                means writing a connector, which is an editor
                                with a compiler behind it — not something anybody
                                does on a phone. The control stays where the work
                                is possible, on the rail of a wide screen. */}
                        </RailBar>
                    )
                    : !isWide && variant === 'library'
                        ? (
                            <div className={`flex shrink-0 gap-1 overflow-x-auto border-b border-hairline p-2 ${SCROLLER_CLASSES}`}>
                                {([
                                    { key: 'all', said: translate('markets.allOfMine'), filter: { kind: 'all' } },
                                    { key: 'recording', said: translate('recording.recordingHere'), filter: { kind: 'recording' } },
                                    ...state.tags.map((one) => ({
                                        key: one.id,
                                        said: labelOf(one, translate),
                                        filter: { kind: 'tag', tagId: one.id },
                                    })),
                                ] as readonly { key: string; said: string; filter: LibraryFilter }[]).map((one) => (
                                    <button
                                        key={one.key}
                                        type="button"
                                        aria-pressed={chipKey(chip) === one.key}
                                        onClick={() => { setChip(one.filter); }}
                                        className={`${CONTROL_CHIP_CLASSES} h-9 shrink-0 justify-center ${
                                            chipKey(chip) === one.key ? CONTROL_CHOSEN_CLASSES : CONTROL_OFFERED_CLASSES
                                        }`}
                                    >
                                        {one.said}
                                    </button>
                                ))}

                                {/* The way to make one more, at the end of the ones
                            there are. Without it the library was a list of
                            filters a reader could never add to. */}
                                {isNamingTag
                                    ? (
                                        <TagNameField
                                            translate={translate}
                                            onName={(label) => {
                                                markets.addTag(label);
                                                setIsNamingTag(false);
                                            }}
                                            onGiveUp={() => { setIsNamingTag(false); }}
                                        />
                                    )
                                    : (
                                        <button
                                            type="button"
                                            aria-label={translate('markets.newTag')}
                                            onClick={() => { setIsNamingTag(true); }}
                                            className={`${CONTROL_CHIP_CLASSES} h-9 shrink-0 justify-center ${CONTROL_OFFERED_CLASSES}`}
                                        >
                                            <Plus className="size-3.5" />
                                        </button>
                                    )}
                            </div>
                        )
                        : !isWide && variant === 'search'
                            ? (
                                <RailBar>
                                    <button
                                        type="button"
                                        onClick={() => { setOpenSource('venue'); }}
                                        className={`${CONTROL_CHIP_CLASSES} h-10 min-w-0 flex-1 justify-between ${CONTROL_OFFERED_CLASSES}`}
                                    >
                                        <span className="min-w-0 truncate">
                                            {query.trim() === ''
                                                ? (showing.kind === 'tag' ? tagLabel : showing.venue)
                                                : translate('markets.acrossVenues')}
                                        </span>
                                        <ChevronRight className="size-4 shrink-0 text-ink-500" />
                                    </button>
                                </RailBar>
                            )
                            : !isWide && variant === 'tabs'
                                ? (
                                    <SourceTabs
                                        open={openSource}
                                        translate={translate}
                                        onOpen={setOpenSource}
                                    />
                                )
                                : !isWide
                                    ? (
                                        <RailBar>
                                            <button
                                                type="button"
                                                onClick={() => { setOpenSource('tag'); }}
                                                className={`${CONTROL_CHIP_CLASSES} h-10 min-w-0 flex-1 justify-between ${CONTROL_OFFERED_CLASSES}`}
                                            >
                                                <span className="min-w-0 truncate">
                                                    {showing.kind === 'tag' ? tagLabel : showing.venue}
                                                </span>
                                                <ChevronRight className="size-4 shrink-0 text-ink-500" />
                                            </button>
                                        </RailBar>
                                    )
                                    : (
                                        <MarketsRail
                                            tags={state.tags}
                                            venues={state.venues}
                                            openTagId={openTag?.id ?? FAVOURITES_ID}
                                            showing={showing}
                                            translate={translate}
                                            onOpenTag={(tagId) => { markets.openTag(tagId); show({ kind: 'tag' }); }}
                                            onBrowse={(venue) => { show({ kind: 'venue', venue }); }}
                                            onAddTag={(label) => { markets.addTag(label); show({ kind: 'tag' }); }}
                                            onRemoveTag={(tagId) => { markets.removeTag(tagId); }}
                                            onRecolourTag={(tagId, tone) => { markets.recolourTag(tagId, tone); }}
                                            onRemoveVenue={(venue) => { markets.removeConnector(venue); show({ kind: 'tag' }); }}
                                            broughtVenues={brought}
                                            onWriteConnector={onWriteConnector}
                                        />
                                    )}
            banner={!isWide ? undefined : (
                <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-hairline px-3 py-2">
                    {/* What is being looked at, which is the tag the rail is on
                        or the venue being browsed. Filing is done on the row
                        itself, so this says nothing about where a press would
                        put anything. */}
                    <span className="flex items-center gap-1.5 text-[11px] text-ink-500">
                        {showing.kind === 'tag' && <TagSwatch colour={tagColour} className="size-2" />}
                        {showing.kind === 'tag' ? tagLabel : showing.venue}
                    </span>
                    <QuoteFilter
                        quotes={quotes}
                        quote={quote}
                        translate={translate}
                        onPick={setQuote}
                    />
                </div>
            )}
            footing={(
                <ListingFooting
                    listing={listing}
                    shown={everywhere?.shown.length ?? narrowed?.shown.length ?? 0}
                    matched={everywhere?.matched ?? narrowed?.matched ?? 0}
                    isAsking={state.search?.kind === 'reading'}
                    translate={translate}
                />
            )}
        >
            {isNamingTag && variant === 'selects' && !isWide
                ? (
                    <>
                        <button
                            type="button"
                            onClick={() => { setIsNamingTag(false); }}
                            className="flex min-h-11 shrink-0 items-center gap-1.5 px-3 text-xs text-ink-500 hover:text-ink-100"
                        >
                            <ArrowLeft className="size-3.5" />
                            {translate('markets.title')}
                        </button>
                        <NewTagCard
                            translate={translate}
                            onMake={(label, colour) => {
                                const tagId = markets.addTag(label);
                                if (tagId !== null) {
                                    markets.recolourTag(tagId, colour);
                                    // Shown as well as made: a reader who has
                                    // just named a tag is about to file
                                    // something under it, and landing back on
                                    // the catalogue they left means the next
                                    // press goes somewhere they did not ask for.
                                    markets.openTag(tagId);
                                    show({ kind: 'tag' });
                                    setChip({ kind: 'tag', tagId });
                                }
                                setIsNamingTag(false);
                            }}
                            onGiveUp={() => { setIsNamingTag(false); }}
                        />
                    </>
                )
                : openSource !== null ? (
                    <>
                        {variant === 'drill' && (
                            <button
                                type="button"
                                onClick={() => { setOpenSource(null); }}
                                className="flex min-h-11 shrink-0 items-center gap-1.5 px-3 text-xs text-ink-500 hover:text-ink-100"
                            >
                                <ArrowLeft className="size-3.5" />
                                {translate('markets.title')}
                            </button>
                        )}
                        <SourceList
                            tags={state.tags}
                            venues={state.venues}
                            openTagId={openTag?.id ?? FAVOURITES_ID}
                            showing={showing}
                            query={query}
                            // A tab shows one kind; a step in shows both, because it
                            // is the whole answer to "what am I looking at".
                            kinds={variant === 'drill' ? ['tag', 'venue'] : [openSource]}
                            translate={translate}
                            onOpenTag={(tagId) => {
                                markets.openTag(tagId);
                                show({ kind: 'tag' });
                                setOpenSource(null);
                            }}
                            onBrowse={(venue) => {
                                show({ kind: 'venue', venue });
                                setOpenSource(null);
                            }}
                            onAddTag={(label) => {
                                markets.addTag(label);
                                show({ kind: 'tag' });
                                setOpenSource(null);
                            }}
                            {...onWriteConnector === undefined
                                ? {}
                                : { onWriteConnector: () => { setOpenSource(null); onWriteConnector(); } }}
                        />
                    </>
                ) : (
                    <Body
                        showing={showing}
                        listing={listing}
                        rowCount={variant === 'library' && !isWide ? mine.length + rows.length : rows.length}
                        query={query}
                        translate={translate}
                        {...everywhere !== null
                            ? { emptySaid: translate('markets.noneAnywhere') }
                            : variant === 'library' && !isWide
                                ? { emptySaid: translate('markets.libraryEmpty') }
                                : {}}
                        onRetry={() => {
                            if (showing.kind === 'venue') {
                                void markets.readListing(showing.venue);
                            }
                        }}
                    >
                        {variant === 'library' && !isWide
                            ? (
                                <div className="min-h-0 flex-1 overflow-y-auto">
                                    {/* What the reader has, first and always. The
                                    catalogues fall in underneath only once
                                    something is typed, so the screen they open
                                    on is four or five rows they recognise
                                    rather than nine hundred they do not. */}
                                    <h4 className="px-3 py-1 field-label">{translate('markets.mine')}</h4>
                                    <PairTable
                                        rows={mine}
                                        hasVenueColumn
                                        open={open}
                                        tags={state.tags}
                                        translate={translate}
                                        onOpen={(pair) => { onOpen(pair); onClose(); }}
                                        onKeep={(pair, tagId, isOn) => {
                                            if (isOn) {
                                                markets.tagPair(tagId, pair);
                                            } else {
                                                markets.untagPair(tagId, pair);
                                            }
                                        }}
                                    />
                                    {/* The catalogues, reached deliberately. The
                                    library is what a reader has; browsing is
                                    the other question, and it has to be asked
                                    somewhere. */}
                                    {query.trim() === '' && (
                                        <div className="px-3 py-2">
                                            <button
                                                type="button"
                                                onClick={() => { setOpenSource('venue'); }}
                                                className={`${PANEL_ADD_CLASSES} min-h-11 w-full`}
                                            >
                                                {translate('markets.browseAVenue')}
                                            </button>
                                        </div>
                                    )}

                                    {query.trim() !== '' && rows.length > 0 && (
                                        <>
                                            <h4 className="px-3 py-1 field-label">
                                                {translate('markets.onTheVenues')}
                                            </h4>
                                            <PairTable
                                                rows={rows}
                                                hasVenueColumn
                                                open={open}
                                                tags={state.tags}
                                                translate={translate}
                                                onOpen={(pair) => { onOpen(pair); onClose(); }}
                                                onKeep={(pair, tagId, isOn) => {
                                                    if (isOn) {
                                                        markets.tagPair(tagId, pair);
                                                    } else {
                                                        markets.untagPair(tagId, pair);
                                                    }
                                                }}
                                            />
                                        </>
                                    )}
                                </div>
                            )
                            : (
                                <PairTable
                                    rows={rows}
                                    hasVenueColumn={showing.kind === 'tag'}
                                    open={open}
                                    tags={state.tags}
                                    translate={translate}
                                    onOpen={(pair) => { onOpen(pair); onClose(); }}
                                    onKeep={(pair, tagId, isOn) => {
                                        if (isOn) {
                                            markets.tagPair(tagId, pair);
                                        } else {
                                            markets.untagPair(tagId, pair);
                                        }
                                    }}
                                />
                            )}
                    </Body>
                )}

        </ListingCard>
    );
}

interface BodyProps {
    readonly showing: Showing;
    readonly listing: Listing;
    readonly rowCount: number;
    readonly query: string;
    readonly translate: Translate;
    readonly onRetry: () => void;
    /** Said instead of the rows, where the search crossed every venue. */
    readonly emptySaid?: string | undefined;
    readonly children: ReactElement;
}

/**
 * The table, or the one sentence that stands in for it.
 *
 * A tag is not a listing: it holds what the reader put in it, so it is never
 * unread, never refused, and empty for a reason of its own. That is the whole
 * of what this adds to the shared body.
 */
function Body({ showing, listing, rowCount, query, translate, onRetry, emptySaid, children }: BodyProps): ReactElement {
    // A search across every catalogue is not about this venue's listing: it is
    // never unread and never refused, and finding nothing means something else.
    if (emptySaid !== undefined) {
        return rowCount === 0 ? <Said said={emptySaid} /> : children;
    }

    if (showing.kind === 'tag') {
        return rowCount === 0 ? <Said said={translate('markets.emptyTag')} /> : children;
    }

    return (
        <ListingBody
            listing={listing}
            rowCount={rowCount}
            query={query}
            emptySaid={translate('markets.noPairs')}
            translate={translate}
            onRetry={onRetry}
        >
            {children}
        </ListingBody>
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
 * Only the symbol, because a tag holds pairs rather than a venue's listing and
 * has no assets of its own to match against.
 */
function matchesQuery(symbol: string, query: string): boolean {
    const wanted = query.trim().toUpperCase();
    return wanted === '' || symbol.toUpperCase().includes(wanted);
}
