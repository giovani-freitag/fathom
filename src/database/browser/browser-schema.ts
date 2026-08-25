/** Name of the database a demo page records into. */
export const DATABASE_NAME = 'fathom-demo';

/** Bumped only when a store or a key path changes. */
export const SCHEMA_VERSION = 1;

/**
 * Store names, deliberately identical to the SQL tables.
 *
 * Keeping them the same means `database/migrations/001_liquidity_schema.sql`
 * documents both engines, and a reader moving between them is never guessing
 * which table a store corresponds to.
 */
export const STORES = {
    instrumentRegistry: 'instrument_registry',
    liquidityFrame: 'liquidity_frame',
    tradeCluster: 'trade_cluster',
    recordingGap: 'recording_gap',
} as const;

/**
 * Creates the stores this version expects.
 *
 * Every key path is compound and starts with the instrument, so a range over
 * one contract is a prefix scan and never touches another's records. No
 * secondary index: every read the chart performs is such a prefix range, and an
 * index would cost a write on every frame to serve a query nobody makes.
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
    if (!database.objectStoreNames.contains(STORES.recordingGap)) {
        database.createObjectStore(STORES.recordingGap, {
            keyPath: ['instrumentSymbol', 'gapStartedAtMs'],
        });
    }
}
