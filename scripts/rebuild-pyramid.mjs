#!/usr/bin/env node
// Builds the levels above the finest again, out of the finest itself.
//
// Only the finest level is a recording; every level above it is folded from the
// one below as the collector runs. That has two consequences. A change to how
// the fold works leaves everything already stored wrong, with no way to notice
// by reading it. And a level built as the recording runs is only ever as old as
// the recording: the coarse levels are what make a wide window cheap to read,
// so for the first day of a contract — and after any prune — a reader zooming
// out is answered off the finest level, which is the slowest possible answer.
//
// Measured on a nine hour window over the whole book, that was about two
// seconds of reading where the pyramid would have answered in a fraction of it.
//
// Safe to run against the live recording. A recorder holds the block it is
// filling in memory and writes it whole, so what one writer puts underneath
// another used to be put back the way it was on the other's next write — a
// block of the coarsest level covers six days, so the collector and this were
// always in the same one. Both now lay the stored block under what they hold
// before writing, and each can tell its own last write from anyone else's by
// the stamp the store leaves, so neither pays for the read while it is alone.
//
//   node --env-file-if-exists=.env scripts/rebuild-pyramid.mjs [SYMBOL...]
//
// Idempotent in the sense that matters: the levels it writes are a function of
// the finest level alone, so running it twice leaves the same archive. It does
// NOT delete first — a level still holding a fold from an older rule keeps
// whatever was larger, because folding takes the largest. Drop them first:
//
//   DELETE FROM whole_book.liquidity_chunk WHERE detail_level > 0;
//   DELETE FROM whole_book.liquidity_block WHERE detail_level > 0;

import { PostgresService } from '../dist/database/postgres/postgres-service.js';
import { PostgresChunkRowStore } from '../dist/database/postgres/postgres-chunk-row-store.js';
import { ChunkArchiveService } from '../dist/database/services/chunk-archive-service.js';
import { ChunkTileRecorder } from '../dist/database/services/chunk-tile-recorder.js';

/** What the collector records with, which the fold has to match exactly. */
const FRAME_INTERVAL_MS = 1_000;
const STEP_RATIO = 1.02;
const PRICE_RANGE_RATIO = 1;

const postgres = new PostgresService({
    connectionString: process.env.DATABASE_URL,
    maximumPoolSize: 4,
    statementTimeoutMs: 120_000,
    channelRetryDelayMs: 1_000,
});
await postgres.connect();
const archive = new ChunkArchiveService({ rows: new PostgresChunkRowStore({ postgres }) });

/**
 * The contracts to rebuild, and the grid each was recorded on.
 *
 * @param wanted - Symbols named on the command line, or none for all of them.
 * @returns One entry per contract that has a finest level to rebuild from.
 */
async function listContracts(wanted) {
    const rows = await postgres.selectRows(
        `SELECT instrument_symbol, max(price_bucket_size) AS price_bucket_size
         FROM whole_book.liquidity_block WHERE detail_level = 0
         GROUP BY instrument_symbol ORDER BY instrument_symbol`,
        [],
    );
    return rows
        .filter((row) => wanted.length === 0 || wanted.includes(row.instrument_symbol))
        .map((row) => ({
            instrumentSymbol: row.instrument_symbol,
            priceBucketSize: Number(row.price_bucket_size),
        }));
}

/**
 * Walks one contract's finest level back through the fold.
 *
 * @param contract - The symbol and the grid it was recorded on.
 * @returns How many instants were replayed.
 */
async function rebuild(contract) {
    const { instrumentSymbol, priceBucketSize } = contract;
    const blocks = await postgres.selectRows(
        `SELECT started_at FROM whole_book.liquidity_block
         WHERE instrument_symbol = $1 AND detail_level = 0 ORDER BY started_at`,
        [instrumentSymbol],
    );

    const recorder = new ChunkTileRecorder({
        archive,
        priceRangeRatio: PRICE_RANGE_RATIO,
        intervalMs: FRAME_INTERVAL_MS,
        stepRatio: STEP_RATIO,
        onWriteFailed: (symbol, reason) => {
            console.error(`  ${symbol}: a square would not store — ${String(reason)}`);
        },
    });

    let replayed = 0;
    for (const [index, block] of blocks.entries()) {
        const startedAtMs = block.started_at.getTime();
        const columns = await archive.readBlock({
            instrumentSymbol, detailLevel: 0, startedAtMs,
        });
        for (const [column, held] of columns.entries()) {
            // Nought for a touch price is a place the fixed grid left empty
            // ahead of the recording, not a book that was empty.
            if (!(held.bestBidPrice > 0)) {
                continue;
            }
            await recorder.replay({
                instrumentSymbol,
                priceBucketSize,
                column: held,
                capturedAtMs: startedAtMs + column * FRAME_INTERVAL_MS,
            });
            replayed += 1;
        }
        process.stdout.write(`\r  ${instrumentSymbol}: block ${String(index + 1)}/${String(blocks.length)}, ${String(replayed)} instants`);
    }
    await recorder.flush();
    process.stdout.write('\n');
    return replayed;
}

const contracts = await listContracts(process.argv.slice(2));
if (contracts.length === 0) {
    console.error('Nothing recorded at the finest level to rebuild from.');
    process.exitCode = 1;
} else {
    for (const contract of contracts) {
        const startedAt = Date.now();
        const replayed = await rebuild(contract);
        console.log(`  ${contract.instrumentSymbol}: ${String(replayed)} instants in ${String(Math.round((Date.now() - startedAt) / 1000))} s`);
    }
}
await postgres.close();
