import { type Listing } from '../core/markets-controller.ts';
import { useEffect } from 'react';
import { useMarkets } from './use-markets.ts';

/** What is known about a venue nobody has asked about yet. */
const UNREAD: Listing = { kind: 'unread' };

/**
 * What a venue lists, asked for the moment it is shown.
 *
 * Asked here rather than on a press of its own, because a reader who picked a
 * venue is already asking what there is to pick. Only where nobody has asked
 * yet: asked again while one is in flight, each pass aborts the last and the
 * listing never lands.
 *
 * @param venue - Which venue is being shown, or null where none is.
 * @returns Its listing, or the unread one where no venue is shown.
 */
export function useVenueListing(venue: string | null): Listing {
    const { state, markets } = useMarkets();
    const listing = venue === null ? UNREAD : state.listings[venue] ?? UNREAD;

    useEffect(() => {
        if (venue !== null && listing.kind === 'unread') {
            void markets.readListing(venue);
        }
    }, [listing.kind, markets, venue]);

    return listing;
}
