/** Name of the database a demo page records into. */
export const DATABASE_NAME = 'fathom-demo';

/** Bumped only when a store or a key path changes. */
export const SCHEMA_VERSION = 4;

/**
 * Store names, deliberately identical to the SQL tables.
 */
export const STORES = {
    instrumentRegistry: 'instrument_registry',
    liquidityFrame: 'liquidity_frame',
    tradeCluster: 'trade_cluster',
    recordingGap: 'recording_gap',
    recordingControl: 'recording_control',
    liquidityBlock: 'liquidity_block',
    liquidityChunk: 'liquidity_chunk',
} as const;

/**
 * The block index a window read is served off.
 *
 * A window wants the blocks that overlap it, which is two conditions on two
 * different fields — one ends after the window opens, the other opens before it
 * closes. A key range can only bound one field, so the range is taken on the
 * instant a block reaches and the walk stops at the first block that opens too
 * late. Blocks of one level are fixed and never overlap, so the two orders are
 * the same order and stopping early is exact.
 */
export const BLOCK_REACH_INDEX = 'endedAt';

/**
 * Creates the stores this version expects.
 *
 * @param database - The connection being upgraded.
 * @param upgrade - The upgrade's own transaction, for reaching a store that
 *                  already exists to add an index to it.
 */
export function createStores(database: IDBDatabase, upgrade: IDBTransaction): void {
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
    // The whole book as fixed squares, the same shape a server keeps it in. A
    // block is addressed by where it sits rather than by when it was written,
    // so the key is the address and a rewrite of a block still filling lands on
    // the record it is replacing.
    const blocks = database.objectStoreNames.contains(STORES.liquidityBlock)
        ? upgrade.objectStore(STORES.liquidityBlock)
        : database.createObjectStore(STORES.liquidityBlock, {
            keyPath: ['instrumentSymbol', 'detailLevel', 'startedAtMs'],
        });
    if (!blocks.indexNames.contains(BLOCK_REACH_INDEX)) {
        blocks.createIndex(BLOCK_REACH_INDEX, ['instrumentSymbol', 'detailLevel', 'endedAtMs']);
    }
    if (!database.objectStoreNames.contains(STORES.liquidityChunk)) {
        database.createObjectStore(STORES.liquidityChunk, {
            keyPath: ['instrumentSymbol', 'detailLevel', 'startedAtMs', 'lowestBucketIndex'],
        });
    }
}
