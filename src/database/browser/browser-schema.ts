/** Name of the database a demo page records into. */
export const DATABASE_NAME = 'fathom-demo';

/** Bumped only when a store or a key path changes. */
export const SCHEMA_VERSION = 2;

/**
 * Store names, deliberately identical to the SQL tables.
 */
export const STORES = {
    instrumentRegistry: 'instrument_registry',
    liquidityFrame: 'liquidity_frame',
    tradeCluster: 'trade_cluster',
    recordingGap: 'recording_gap',
    recordingControl: 'recording_control',
} as const;

/**
 * Creates the stores this version expects.
 *
 * @param database - The connection being upgraded.
 */
export function createStores(database: IDBDatabase): void {
    if (!database.objectStoreNames.contains(STORES.instrumentRegistry)) {
        database.createObjectStore(STORES.instrumentRegistry, { keyPath: 'instrumentSymbol' });
    }
    if (!database.objectStoreNames.contains(STORES.liquidityFrame)) {
        database.createObjectStore(STORES.liquidityFrame, {
            keyPath: ['instrumentSymbol', 'capturedAtMs'],
        });
    }
    if (!database.objectStoreNames.contains(STORES.tradeCluster)) {
        database.createObjectStore(STORES.tradeCluster, {
            keyPath: ['instrumentSymbol', 'executedAtMs', 'priceBucketIndex'],
        });
    }
    if (!database.objectStoreNames.contains(STORES.recordingControl)) {
        // One row, keyed by a name, holding the choice a reader made. In the
        // store rather than in local storage because a Web Worker cannot read
        // local storage, and the collector inside one has to see the choice.
        database.createObjectStore(STORES.recordingControl, { keyPath: 'key' });
    }
    if (!database.objectStoreNames.contains(STORES.recordingGap)) {
        database.createObjectStore(STORES.recordingGap, {
            keyPath: ['instrumentSymbol', 'gapStartedAtMs'],
        });
    }
}
