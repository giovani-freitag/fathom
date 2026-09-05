import { ObservableStore } from './observable-store.ts';
import {
    FAVOURITES_ID,
    type MarketPair,
    type PairTag,
    type TagColour,
    withPairTagged,
    withPairUntagged,
    withTagAdded,
    withTagRecoloured,
    withTagRelabelled,
    withTagRemoved,
} from '../../shared/core/pair-tags.ts';
import { forgetConnector, listConnectors, registerConnector } from '../../shared/venues/venue-registry.ts';
import type { PreferencesService } from '../services/preferences-service.ts';
import type { ReadingFiles } from '../../shared/core/reading-files.ts';
import type { StoredConnector } from '../../shared/core/stored-connector.ts';
import type { VenueConnector, VenueInstrument } from '../../shared/core/venue-connector.ts';
import type { VenueGateway } from '../../shared/venues/venue-gateway.ts';
import { VenueUnreachableError } from '../../shared/venues/venue-gateway.ts';

/** What is known about one venue's listing, and how it got that way. */
export type Listing =
    | { readonly kind: 'unread' }
    | {
        readonly kind: 'reading';
        /** What has arrived so far, which the picker shows rather than hides. */
        readonly instruments: readonly VenueInstrument[];
        /** How many there will be, where the venue said. */
        readonly total: number | null;
    }
    | { readonly kind: 'read'; readonly instruments: readonly VenueInstrument[] }
    | {
        readonly kind: 'refused';
        /**
         * What the venue or the connector said, in whatever words those were.
         *
         * Null where nothing was asked at all, because nothing on this build
         * knows how to read that venue — a sentence the interface has, since
         * the words a reader is shown are the interface's to choose.
         */
        readonly said: string | null;
    };

/**
 * What a venue answered about what a reader typed.
 *
 * Held apart from the listing rather than merged into it: a search is the
 * venue's answer to one question asked once, and folding it into the listing
 * would leave the picker unable to say which rows it had actually read.
 */
export interface VenueSearch {
    readonly venue: string;
    readonly term: string;
    readonly kind: 'reading' | 'read' | 'refused';
    readonly instruments: readonly VenueInstrument[];
}

export interface MarketsState {
    readonly tags: readonly PairTag[];
    /** Which tag the picker is showing, and which one a press files under. */
    readonly openTagId: string;
    /** Every venue the chart can reach, shipped and brought alike. */
    readonly venues: readonly string[];
    /** Which venue is being browsed. */
    readonly browsingVenue: string;
    /** What each venue lists, once anybody has asked. */
    readonly listings: Readonly<Record<string, Listing>>;
    /**
     * The venue's own answer to what the reader typed, where it offers one.
     *
     * Null where nothing has been typed, or where the venue answers no such
     * question — and then the picker searches what it has read instead.
     */
    readonly search: VenueSearch | null;
    /** The connectors the reader installed, for the interface to show and undo. */
    readonly installed: readonly StoredConnector[];
}

export interface MarketsControllerConfig {
    readonly preferences: PreferencesService;
    readonly gateway: VenueGateway;
    readonly readNowMs: () => number;
}

/**
 * The pairs a reader keeps, and the venues they come from.
 *
 * One controller for both because they are one decision: a tag holds pairs from
 * several venues, and a venue is worth adding precisely so that something on it
 * can be filed under a tag.
 */
export class MarketsController {
    readonly store: ObservableStore<MarketsState>;

    private readonly config: MarketsControllerConfig;
    private readonly inFlight = new Map<string, AbortController>();
    private searching: AbortController | null = null;

    constructor(config: MarketsControllerConfig) {
        this.config = config;
        const stored = config.preferences.read();

        this.store = new ObservableStore<MarketsState>({ initialState: {
            tags: stored.pairTags,
            openTagId: stored.pairTags[0]?.id ?? FAVOURITES_ID,
            venues: listConnectors().map(([id]) => id),
            browsingVenue: listConnectors()[0]?.[0] ?? '',
            listings: {},
            search: null,
            installed: stored.connectorSources,
        } });
    }

    /**
     * Files a pair under a tag.
     *
     * @param tagId - Which tag.
     * @param pair - The venue and symbol being kept.
     */
    tagPair(tagId: string, pair: MarketPair): void {
        this.writeTags(withPairTagged(this.store.read().tags, tagId, pair));
    }

    /**
     * Takes a pair out from under a tag.
     *
     * @param tagId - Which tag.
     * @param pair - The venue and symbol being dropped.
     */
    untagPair(tagId: string, pair: MarketPair): void {
        this.writeTags(withPairUntagged(this.store.read().tags, tagId, pair));
    }

    /**
     * Makes a tag and opens it.
     *
     * Opened as well as made, because a reader who has just named a tag is
     * about to file something under it, and leaving them on the previous one
     * means the next thing they press goes somewhere they did not ask for.
     *
     * @param label - What the reader called it.
     */
    addTag(label: string): void {
        const held = this.store.read().tags;
        const tags = withTagAdded(held, label);
        if (tags.length === held.length) {
            return;
        }

        this.writeTags(tags);
        this.store.update((current) => ({ ...current, openTagId: tags[tags.length - 1]!.id }));
    }

    /**
     * Removes a tag, and with it every pair filed only under that tag.
     *
     * @param tagId - Which tag.
     */
    removeTag(tagId: string): void {
        const tags = withTagRemoved(this.store.read().tags, tagId);
        this.writeTags(tags);
        if (!tags.some((tag) => tag.id === this.store.read().openTagId)) {
            this.store.update((current) => ({ ...current, openTagId: tags[0]?.id ?? FAVOURITES_ID }));
        }
    }

    /**
     * Relabels a tag.
     *
     * @param tagId - Which tag.
     * @param label - What to call it now.
     */
    relabelTag(tagId: string, label: string): void {
        this.writeTags(withTagRelabelled(this.store.read().tags, tagId, label));
    }

    /**
     * Marks a tag in a different colour.
     *
     * @param tagId - Which tag.
     * @param colour - What to mark it in.
     */
    recolourTag(tagId: string, colour: TagColour): void {
        this.writeTags(withTagRecoloured(this.store.read().tags, tagId, colour));
    }

    /**
     * Shows a different tag.
     *
     * @param tagId - Which tag to open.
     */
    openTag(tagId: string): void {
        this.store.update((current) => ({ ...current, openTagId: tagId }));
    }

    /**
     * Browses a different venue, reading its listing if nobody has yet.
     *
     * @param venue - Which venue to browse.
     */
    browse(venue: string): void {
        this.store.update((current) => ({ ...current, browsingVenue: venue }));
        if (this.store.read().listings[venue]?.kind !== 'read') {
            void this.readListing(venue);
        }
    }

    /**
     * Asks a venue what it trades.
     *
     * Safe to call again while one is already in flight for that venue: the
     * earlier request is dropped rather than raced, so a reader pressing retry
     * twice cannot end up with the first answer overwriting the second.
     *
     * @param venue - Which venue to ask.
     */
    async readListing(venue: string): Promise<void> {
        const connector = listConnectors().find(([id]) => id === venue)?.[1];
        if (connector === undefined) {
            this.writeListing(venue, { kind: 'refused', said: null });
            return;
        }

        this.inFlight.get(venue)?.abort();
        const aborts = new AbortController();
        this.inFlight.set(venue, aborts);
        this.writeListing(venue, { kind: 'reading', instruments: [], total: null });

        try {
            const instruments = await this.config.gateway.fetchInstruments(
                connector,
                // Shown as it lands. A card that stays empty until the last page
                // of four thousand pairs arrives cannot be told from a broken
                // one, and the reader is usually after a pair on the first page.
                (gathered, total) => {
                    if (this.inFlight.get(venue) === aborts) {
                        this.writeListing(venue, { kind: 'reading', instruments: gathered, total });
                    }
                },
                aborts.signal,
            );
            if (this.inFlight.get(venue) === aborts) {
                this.writeListing(venue, { kind: 'read', instruments });
            }
        } catch (error) {
            if (this.inFlight.get(venue) === aborts) {
                this.writeListing(venue, { kind: 'refused', said: describeRefusal(error) });
            }
        } finally {
            if (this.inFlight.get(venue) === aborts) {
                this.inFlight.delete(venue);
            }
        }
    }

    /**
     * Asks a venue what it lists under what the reader typed.
     *
     * Only where the venue offers a search of its own: everywhere else the
     * picker searches what it has already read, and this leaves nothing behind
     * for it to have to ignore.
     *
     * @param venue - Which venue is being browsed.
     * @param term - What the reader typed, empty where they cleared it.
     */
    async searchListing(venue: string, term: string): Promise<void> {
        const wanted = term.trim();
        this.searching?.abort();
        this.searching = null;

        const connector = listConnectors().find(([id]) => id === venue)?.[1];
        if (wanted === '' || connector === undefined) {
            this.writeSearch(null);
            return;
        }

        const aborts = new AbortController();
        this.searching = aborts;
        const asked: VenueSearch = { venue, term: wanted, kind: 'reading', instruments: [] };
        this.writeSearch(asked);

        try {
            const found = await this.config.gateway.searchInstruments(connector, wanted, aborts.signal);
            if (this.searching !== aborts) {
                return;
            }
            // Null is the venue saying it has no such endpoint, which is not a
            // failure and must not be shown as one.
            this.writeSearch(found === null ? null : { ...asked, kind: 'read', instruments: found });
        } catch {
            if (this.searching === aborts) {
                this.writeSearch({ ...asked, kind: 'refused' });
            }
        } finally {
            if (this.searching === aborts) {
                this.searching = null;
            }
        }
    }

    /**
     * Puts a connector a reader wrote where the chart can find it, and keeps it.
     *
     * @param connectorId - What it answers to, which every recording repeats.
     * @param connector - What it declares and how it reads.
     * @param files - Every file it was built from, so it can be built again.
     * @returns Null once it is installed, or why it could not be.
     */
    installConnector(connectorId: string, connector: VenueConnector, files: ReadingFiles): string | null {
        try {
            registerConnector(connectorId, connector);
        } catch (error) {
            return error instanceof Error ? error.message : String(error);
        }

        const installed: StoredConnector = {
            id: connectorId,
            name: connectorId,
            files,
            installedAtMs: this.config.readNowMs(),
        };
        const kept = [
            ...this.store.read().installed.filter((held) => held.id !== connectorId),
            installed,
        ];
        this.config.preferences.write({ connectorSources: kept });

        this.store.update((current) => ({
            ...current,
            installed: kept,
            venues: listConnectors().map(([id]) => id),
            browsingVenue: connectorId,
        }));
        // Read straight away rather than on the next press: a reader who has
        // just installed a venue is asking whether it works, and an empty panel
        // with a button on it does not answer that.
        void this.readListing(connectorId);
        return null;
    }

    /**
     * Takes a venue a reader brought back off the chart.
     *
     * The pairs they kept from it are left where they are. A venue removed by
     * mistake is one press to put back, and a tag quietly emptied by that press
     * is not.
     *
     * @param connectorId - Which venue.
     */
    removeConnector(connectorId: string): void {
        forgetConnector(connectorId);
        const kept = this.store.read().installed.filter((held) => held.id !== connectorId);
        this.config.preferences.write({ connectorSources: kept });

        this.store.update((current) => ({
            ...current,
            installed: kept,
            venues: listConnectors().map(([id]) => id),
            browsingVenue: current.browsingVenue === connectorId
                ? listConnectors()[0]?.[0] ?? ''
                : current.browsingVenue,
        }));
    }

    private writeTags(tags: readonly PairTag[]): void {
        this.config.preferences.write({ pairTags: tags });
        this.store.update((current) => ({ ...current, tags }));
    }

    private writeSearch(search: VenueSearch | null): void {
        this.store.update((current) => ({ ...current, search }));
    }

    private writeListing(venue: string, listing: Listing): void {
        this.store.update((current) => ({
            ...current,
            listings: { ...current.listings, [venue]: listing },
        }));
    }
}

/**
 * Why a venue would not answer, in words worth showing a reader.
 */
function describeRefusal(error: unknown): string {
    if (error instanceof VenueUnreachableError) {
        return error.message;
    }
    return error instanceof Error ? error.message : String(error);
}
