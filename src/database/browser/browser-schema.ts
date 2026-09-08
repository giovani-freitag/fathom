/** Name of the database a demo page records into. */
export const DATABASE_NAME = 'fathom-demo';

/** Bumped only when a store or a key path changes. */
export const SCHEMA_VERSION = 7;

/** The store a page kept a row per instant in, before it kept squares. */
const RETIRED_STORE = 'liquidity_frame';

/**
 * The stores whose key gained the venue, and what it cost to add it.
 *
 * A key path cannot be altered, so a store keyed by the symbol alone has to be
 * dropped and made again — and what a page recorded under the old key goes with
 * it. It is allowed to go because this store is a window, not an archive: it is
 * bounded by a disk budget and drops its own oldest recording to stay inside
 * one, so everything in it was already on its way out. It is also only the demo
 * page's: the served chart reads a server, and the history that cannot be
 * recorded again lives there, under a migration that kept every row.
 *
 * Carrying it across was weighed and refused, which is worth writing down so
 * that it is not weighed again from nothing. Between dropping the store and
 * making it again the records exist only where they are held, and the ceiling
 * here is a quarter of the browser's whole quota — half a gibibyte on a browser
 * offering two — so reading them into memory at once is the crash it is trying
 * to avoid. Streaming them through a store kept aside costs no memory but twice
 * the disk while it runs, and a reader near their ceiling would abort the
 * upgrade: a page that will not open at all, in place of a recording that was
 * leaving anyway.
 */
const REKEYED_STORES = [
    'instrument_registry', 'liquidity_block', 'liquidity_chunk',
    'trade_cluster', 'recording_gap',
] as const;

/**
 * Store names, deliberately identical to the SQL tables.
 */
export const STORES = {
    instrumentRegistry: 'instrument_registry',
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
    // A page that recorded under an older build is carrying a store nothing
    // reads. It is the largest thing in there — a row per instant against the
    // squares that replaced it — so it goes on the way past rather than being
    // left for a visitor to wonder about.
    if (database.objectStoreNames.contains(RETIRED_STORE)) {
        database.deleteObjectStore(RETIRED_STORE);
    }

    // Before they are made again below, and only where one is already there
    // under the old key. On a first visit there is nothing to drop.
    for (const store of REKEYED_STORES) {
        if (database.objectStoreNames.contains(store)) {
            database.deleteObjectStore(store);
        }
    }

    if (!database.objectStoreNames.contains(STORES.instrumentRegistry)) {
        database.createObjectStore(STORES.instrumentRegistry, {
            keyPath: ['venue', 'instrumentSymbol'],
        });
    }
    if (!database.objectStoreNames.contains(STORES.tradeCluster)) {
        database.createObjectStore(STORES.tradeCluster, {
            keyPath: ['venue', 'instrumentSymbol', 'executedAtMs', 'priceBucketIndex'],
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
            keyPath: ['venue', 'instrumentSymbol', 'gapStartedAtMs'],
        });
    }
    // The whole book as fixed squares, the same shape a server keeps it in. A
    // block is addressed by where it sits rather than by when it was written,
    // so the key is the address and a rewrite of a block still filling lands on
    // the record it is replacing.
    //
    // The venue opens that address. Two venues both list BTCUSDT, and keyed by
    // the symbol alone the second one recorded would land its squares on the
    // first one's rather than beside them — over a book nobody can record
    // again.
    const blocks = database.objectStoreNames.contains(STORES.liquidityBlock)
        ? upgrade.objectStore(STORES.liquidityBlock)
        : database.createObjectStore(STORES.liquidityBlock, {
            keyPath: ['venue', 'instrumentSymbol', 'detailLevel', 'startedAtMs'],
        });
    if (!blocks.indexNames.contains(BLOCK_REACH_INDEX)) {
        blocks.createIndex(BLOCK_REACH_INDEX, [
            'venue', 'instrumentSymbol', 'detailLevel', 'endedAtMs',
        ]);
    }
    if (!database.objectStoreNames.contains(STORES.liquidityChunk)) {
        database.createObjectStore(STORES.liquidityChunk, {
            keyPath: ['venue', 'instrumentSymbol', 'detailLevel', 'startedAtMs', 'lowestBucketIndex'],
        });
    }
}
