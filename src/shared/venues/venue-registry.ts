import { BINANCE_CONNECTOR } from './binance-connector.ts';
import { BINANCE_FUTURES_ID } from './binance-futures.ts';
import { BYBIT_CONNECTOR, BYBIT_ID } from './bybit-connector.ts';
import { COINBASE_CONNECTOR, COINBASE_ID } from './coinbase-connector.ts';
import { findContradictions, findPacingFaults, type VenueConnector } from '../core/venue-connector.ts';
import { GATE_CONNECTOR, GATE_ID } from './gate-connector.ts';
import { KRAKEN_CONNECTOR, KRAKEN_ID } from './kraken-connector.ts';
import { OKX_CONNECTOR, OKX_ID } from './okx-connector.ts';
import { readVenueFacts, type VenueFact } from '../core/venue-plan.ts';

/**
 * What every connector a reader wrote answers to.
 *
 * Reserved, so a connector brought in can never take the name of one the build
 * ships under — a recording filed under the wrong venue cannot be filed again.
 */
export const CONNECTOR_ID_PREFIX = 'venue:';

/** What a connector may be called: lowercase, unpunctuated, short enough to read. */
const LEGAL_CONNECTOR_ID = /^[a-z][a-z0-9-]{1,31}$/;

/**
 * The venues this build knows how to read without anybody writing anything.
 *
 * Six, and five of them are here to be read against the first: between them
 * they page a listing two different ways, send candles in three different
 * field orders, and decline a book for three different reasons. A contract
 * proved against one venue is a contract shaped like that venue.
 */
const SHIPPED: readonly (readonly [string, VenueConnector])[] = [
    [BINANCE_FUTURES_ID, BINANCE_CONNECTOR],
    [BYBIT_ID, BYBIT_CONNECTOR],
    [OKX_ID, OKX_CONNECTOR],
    [COINBASE_ID, COINBASE_CONNECTOR],
    [KRAKEN_ID, KRAKEN_CONNECTOR],
    [GATE_ID, GATE_CONNECTOR],
];

const REGISTERED = new Map<string, VenueConnector>(SHIPPED);

/**
 * Whether a name belongs to a venue this build ships with.
 *
 * @param connectorId - The name being asked about.
 * @returns True where the name is a shipped venue's.
 */
export function isShippedVenue(connectorId: string): boolean {
    return SHIPPED.some(([id]) => id === connectorId);
}

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
 * @param connector - What it declares and how it reads what the venue says.
 * @returns The id it is stored under.
 * @throws Error when the name could be read as the shipped venue's, or when the
 *         connector declares one thing and reads another.
 */
export function registerConnector(connectorId: string, connector: VenueConnector): string {
    if (!isLegalConnectorId(connectorId)) {
        throw new Error(`“${connectorId}” cannot be a connector's name.`);
    }
    if (isShippedVenue(connectorId)) {
        throw new Error(`${connectorId} is a venue this build ships with.`);
    }

    // Refused now rather than when a recording starts, which is hours later on a
    // machine nobody is watching, with the contradiction already in the file.
    const faults = [...findContradictions(connector), ...findPacingFaults(connector)];
    if (faults.length > 0) {
        throw new Error(faults.join(' '));
    }

    REGISTERED.set(connectorId, connector);
    return connectorId;
}

/**
 * Takes a connector back off the chart.
 *
 * @param connectorId - The id it was registered under.
 */
export function forgetConnector(connectorId: string): void {
    if (!isShippedVenue(connectorId)) {
        REGISTERED.delete(connectorId);
    }
}

/** Every connector the chart can reach, the shipped one included. */
export function listConnectors(): readonly (readonly [string, VenueConnector])[] {
    return [...REGISTERED];
}

/**
 * One connector by name.
 *
 * @param connectorId - Which venue.
 * @returns Its connector, or null where none was registered.
 */
export function findConnector(connectorId: string): VenueConnector | null {
    return REGISTERED.get(connectorId) ?? null;
}

/**
 * One connector by name, insisting there is one.
 *
 * For the collector, which cannot go on without it: a recording opened against
 * a venue nothing can read would write a contract's worth of nothing, and the
 * hours it did so cannot be recorded again.
 *
 * @param connectorId - Which venue.
 * @returns Its connector.
 * @throws Error when no connector was registered under that name.
 */
export function readConnector(connectorId: string): VenueConnector {
    const held = REGISTERED.get(connectorId);
    if (held === undefined) {
        throw new Error(`Nothing knows how to read “${connectorId}”.`);
    }
    return held;
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
    return held === undefined ? new Set<VenueFact>() : readVenueFacts(held.declaration);
}


/**
 * Where a venue's own mark can be fetched, or null where nothing can say.
 *
 * Taken from the connector where it named one, and otherwise guessed from the
 * host it asks its first question of: most venues serve a mark at the root of
 * the same domain their API answers on. A guess, and treated as one — whatever
 * draws this has to survive the address answering with nothing.
 *
 * @param connectorId - Which venue.
 * @returns An absolute address, or null where the venue is not registered.
 */
export function readMarkFor(connectorId: string): string | null {
    const connector = REGISTERED.get(connectorId);
    if (connector === undefined) {
        return null;
    }
    if (connector.markUrl !== null) {
        return connector.markUrl;
    }

    try {
        return new URL('/favicon.ico', connector.planInstruments(0).url).href;
    } catch {
        // A connector that cannot describe its first request has bigger
        // problems than a missing picture.
        return null;
    }
}
