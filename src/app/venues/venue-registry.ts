import { BINANCE_FUTURES, BINANCE_FUTURES_ID } from './binance-futures.ts';
import { readVenueFacts, type VenueDeclaration, type VenueFact } from '../../shared/core/venue-plan.ts';

/**
 * What every connector a reader wrote answers to.
 *
 * Reserved, so a connector brought in can never take the name of one the build
 * ships under — a recording filed under the wrong venue cannot be filed again.
 */
export const CONNECTOR_ID_PREFIX = 'venue:';

/** What a connector may be called: lowercase, unpunctuated, short enough to read. */
const LEGAL_CONNECTOR_ID = /^[a-z][a-z0-9-]{1,31}$/;

const REGISTERED = new Map<string, VenueDeclaration>([[BINANCE_FUTURES_ID, BINANCE_FUTURES]]);

/**
 * Whether a name may be a connector's.
 *
 * @param connectorId - The name a connector would be registered under.
 * @returns True when nothing about it could be read two ways.
 */
export function isLegalConnectorId(connectorId: string): boolean {
    return LEGAL_CONNECTOR_ID.test(connectorId);
}

/**
 * Puts a connector a reader wrote where the chart can find it.
 *
 * @param connectorId - What the reader called it.
 * @param declaration - What it says the venue can and cannot do.
 * @returns The id it is stored under.
 * @throws Error when the name could be read as the shipped venue's.
 */
export function registerConnector(connectorId: string, declaration: VenueDeclaration): string {
    if (!isLegalConnectorId(connectorId)) {
        throw new Error(`“${connectorId}” cannot be a connector's name.`);
    }
    if (connectorId === BINANCE_FUTURES_ID) {
        throw new Error(`${connectorId} is the venue this build ships with.`);
    }

    REGISTERED.set(connectorId, declaration);
    return connectorId;
}

/**
 * Takes a connector back off the chart.
 *
 * @param connectorId - The id it was registered under.
 */
export function forgetConnector(connectorId: string): void {
    if (connectorId !== BINANCE_FUTURES_ID) {
        REGISTERED.delete(connectorId);
    }
}

/** Every connector the chart can reach, the shipped one included. */
export function listConnectors(): readonly (readonly [string, VenueDeclaration])[] {
    return [...REGISTERED];
}

/**
 * What one venue supplies, for the chart to judge its layers against.
 *
 * A venue nothing was registered for supplies nothing rather than everything:
 * an unknown connector is one whose script has not run, and offering every
 * layer against it would draw five of them flat over an absence.
 *
 * @param connectorId - Which venue.
 * @returns The facts a reading may rely on there.
 */
export function readFactsFor(connectorId: string): ReadonlySet<VenueFact> {
    const held = REGISTERED.get(connectorId);
    return held === undefined ? new Set<VenueFact>() : readVenueFacts(held);
}
