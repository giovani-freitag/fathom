import { ObservableStore } from './observable-store.ts';
import {
    FAVOURITES_ID,
    type WatchedPair,
    type WatchList,
    withListAdded,
    withListRemoved,
    withListRenamed,
    withPairAdded,
    withPairRemoved,
} from '../../shared/core/watch-lists.ts';
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
    | { readonly kind: 'reading' }
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

export interface MarketsState {
    readonly lists: readonly WatchList[];
    /** Which list the picker is showing. */
    readonly openListId: string;
    /** Every venue the chart can reach, shipped and brought alike. */
    readonly venues: readonly string[];
    /** Which venue is being browsed. */
    readonly browsingVenue: string;
    /** What each venue lists, once anybody has asked. */
    readonly listings: Readonly<Record<string, Listing>>;
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
 * One controller for both because they are one decision: a list holds pairs
 * from several venues, and a venue is worth adding precisely so that something
 * on it can go in a list.
 */
export class MarketsController {
    readonly store: ObservableStore<MarketsState>;

    private readonly config: MarketsControllerConfig;
    private readonly inFlight = new Map<string, AbortController>();

    constructor(config: MarketsControllerConfig) {
        this.config = config;
        const stored = config.preferences.read();

        this.store = new ObservableStore<MarketsState>({ initialState: {
            lists: stored.watchLists,
            openListId: stored.watchLists[0]?.id ?? FAVOURITES_ID,
            venues: listConnectors().map(([id]) => id),
            browsingVenue: listConnectors()[0]?.[0] ?? '',
            listings: {},
            installed: stored.connectorSources,
        } });
    }

    /**
     * Puts a pair in a list.
     *
     * @param listId - Which list.
     * @param pair - The venue and symbol being kept.
     */
    addPair(listId: string, pair: WatchedPair): void {
        this.writeLists(withPairAdded(this.store.read().lists, listId, pair));
    }

    /**
     * Takes a pair out of a list.
     *
     * @param listId - Which list.
     * @param pair - The venue and symbol being dropped.
     */
    removePair(listId: string, pair: WatchedPair): void {
        this.writeLists(withPairRemoved(this.store.read().lists, listId, pair));
    }

    /**
     * Makes a list and opens it.
     *
     * Opened as well as made, because a reader who has just named a list is
     * about to put something in it, and leaving them on the previous one means
     * the next thing they star goes somewhere they did not ask for.
     *
     * @param name - What the reader called it.
     */
    addList(name: string): void {
        const held = this.store.read().lists;
        const lists = withListAdded(held, name);
        if (lists.length === held.length) {
            return;
        }

        this.writeLists(lists);
        this.store.update((current) => ({ ...current, openListId: lists[lists.length - 1]!.id }));
    }

    /**
     * Removes a list and everything filed in it.
     *
     * @param listId - Which list.
     */
    removeList(listId: string): void {
        const lists = withListRemoved(this.store.read().lists, listId);
        this.writeLists(lists);
        if (!lists.some((list) => list.id === this.store.read().openListId)) {
            this.store.update((current) => ({ ...current, openListId: lists[0]?.id ?? FAVOURITES_ID }));
        }
    }

    /**
     * Renames a list.
     *
     * @param listId - Which list.
     * @param name - What to call it now.
     */
    renameList(listId: string, name: string): void {
        this.writeLists(withListRenamed(this.store.read().lists, listId, name));
    }

    /**
     * Shows a different list.
     *
     * @param listId - Which list to open.
     */
    openList(listId: string): void {
        this.store.update((current) => ({ ...current, openListId: listId }));
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
        this.writeListing(venue, { kind: 'reading' });

        try {
            const instruments = await this.config.gateway.fetchInstruments(connector, aborts.signal);
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
     * mistake is one press to put back, and a list quietly emptied by that press
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

    private writeLists(lists: readonly WatchList[]): void {
        this.config.preferences.write({ watchLists: lists });
        this.store.update((current) => ({ ...current, lists }));
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
