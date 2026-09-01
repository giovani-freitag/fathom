#!/usr/bin/env node
// Reads the same minutes out of both stores and compares them cell by cell.
//
// The chunked archive is what the chart reads and the frame table is what the
// recording writes, and they hold the book in shapes that share no code: one
// folds instants into squares on a logarithmic scale, the other keeps a row per
// price. Both fold a stretch of instants into a drawn column, split the two
// sides at the touch, and lay the prices on a grid — the same twenty rules,
// written twice — so a rule that drifts in one of them shows up here as a
// difference that looks like a difference between stores.
//
// Measured once by hand, the frame table folded a drawn column by the mean
// while the chunked store folded by the largest, understating a wall by up to
// five times — in the store the other was being judged against.
//
// This is the check that survives the stores that were retired, and it is worth
// keeping: it caught that fold, and it caught a pyramid folding price as well
// as time. The frame table holds only a band around the price, so run it over a
// band the market actually stood in.
//
// Sizes are stored on a ratio scale and the ratios differ per store, so cells
// are compared within a tolerance rather than for equality. A cell held by one
// store and not the other is counted separately: that is a disagreement about
// what was there at all, and no tolerance covers it.
//
//   node --env-file-if-exists=.env scripts/compare-stores.mjs [SYMBOL] [MINUTES]

import { decodeLiquidityFrameWindow } from '../dist/shared/codec/heatmap-codec.js';

/** The stores the gateway will answer for, the first standing as the reference. */
const SOURCES = ['chunks', 'frames'];

/** How far two sizes may be apart and still be the same wall. */
const TOLERATED_RATIO = 1.1;

/**
 * A stretch ending before the live edge, so no store is caught mid-write.
 *
 * The recorders write on a cadence of their own — sixteen columns for one, a
 * minute for another — so the newest seconds are in one store and not yet in
 * the next, and comparing them there measures the cadence rather than the fold.
 */
const SETTLE_MS = 30_000;

const symbol = process.argv[2] ?? 'BTCUSDT';
const minutes = Number(process.argv[3] ?? 10);
const gateway = process.env.GATEWAY_ORIGIN ?? `http://127.0.0.1:${process.env.GATEWAY_PORT ?? 8787}`;

/**
 * Reads one window out of one store.
 *
 * @param source - The store to read from.
 * @param range - The instants and the prices to read over.
 * @returns The window, decoded.
 */
async function readWindow(source, range) {
    const url = new URL('/api/heatmap', gateway);
    url.search = new URLSearchParams({
        symbol,
        fromMs: String(range.fromMs),
        toMs: String(range.toMs),
        maxColumns: '4000',
        maxRows: '1200',
        lowPrice: String(range.lowPrice),
        highPrice: String(range.highPrice),
        source,
    }).toString();

    const response = await fetch(url, {
        headers: process.env.FATHOM_ACCESS_TOKEN
            ? { authorization: `Bearer ${process.env.FATHOM_ACCESS_TOKEN}` }
            : {},
    });
    if (!response.ok) {
        throw new Error(`${source} answered ${String(response.status)}`);
    }
    return decodeLiquidityFrameWindow(await response.arrayBuffer());
}

/**
 * One window as what is resting at each price, at each instant.
 *
 * @param window - The window as the store answered it.
 * @returns Instant to price to size.
 */
function toCells(window) {
    const byInstant = new Map();
    for (const frame of window.frames) {
        const held = new Map();
        for (const ladder of [frame.bids, frame.asks]) {
            for (let index = 0; index < ladder.quantities.length; index += 1) {
                const quantity = ladder.quantities[index] ?? 0;
                if (quantity > 0) {
                    held.set(ladder.lowestBucketIndex + index, quantity);
                }
            }
        }
        byInstant.set(frame.capturedAtMs, held);
    }
    return byInstant;
}

/**
 * How far one store's answer stands from another's.
 *
 * @param reference - The store being compared against.
 * @param other - The store being compared.
 * @returns The counts of cells shared, agreed on, and held by only one.
 */
function compare(reference, other) {
    let shared = 0;
    let agreed = 0;
    let onlyReference = 0;
    let onlyOther = 0;

    for (const [instant, held] of reference) {
        const theirs = other.get(instant);
        if (theirs === undefined) {
            continue;
        }
        for (const [bucketIndex, quantity] of held) {
            const mine = theirs.get(bucketIndex);
            if (mine === undefined) {
                onlyReference += 1;
                continue;
            }
            shared += 1;
            if (Math.abs(Math.log(mine / quantity)) < Math.log(TOLERATED_RATIO)) {
                agreed += 1;
            }
        }
        for (const bucketIndex of theirs.keys()) {
            if (!held.has(bucketIndex)) {
                onlyOther += 1;
            }
        }
    }
    return { shared, agreed, onlyReference, onlyOther };
}

/**
 * The prices the market has been on, so the band holds the book and not the void.
 *
 * @returns The band to read every store over.
 */
async function resolveBand() {
    const response = await fetch(new URL('/api/instruments', gateway));
    const listing = await response.json();
    const instrument = listing.instruments.find((one) => one.instrumentSymbol === symbol);
    const mid = instrument?.lastMidPrice;
    if (!(mid > 0)) {
        throw new Error(`Nothing recorded for ${symbol}`);
    }
    return { lowPrice: mid * 0.995, highPrice: mid * 1.005 };
}

const toMs = Date.now() - SETTLE_MS;
const range = { fromMs: toMs - minutes * 60_000, toMs, ...(await resolveBand()) };

const windows = new Map();
for (const source of SOURCES) {
    windows.set(source, await readWindow(source, range));
}

console.log(`${symbol}, ${String(minutes)} minutes to ${new Date(toMs).toISOString()}`);
for (const [source, window] of windows) {
    console.log(`  ${source.padEnd(12)} ${String(window.frames.length).padStart(5)} columns`
        + `  ${String(window.priceBucketSize).padStart(6)} per row`
        + `  ${String(window.sampleIntervalMs).padStart(7)} ms per column`);
}

const [referenceName] = SOURCES;
const reference = toCells(windows.get(referenceName));
let disagreed = 0;
for (const source of SOURCES.slice(1)) {
    const counts = compare(reference, toCells(windows.get(source)));
    const agreement = counts.shared === 0 ? 0 : counts.agreed / counts.shared * 100;
    disagreed += counts.shared - counts.agreed + counts.onlyReference + counts.onlyOther;
    console.log(`  ${referenceName} vs ${source.padEnd(12)}`
        + ` ${String(counts.shared).padStart(8)} shared  ${agreement.toFixed(2)}% agree`
        + `  ${String(counts.onlyReference).padStart(6)} only in ${referenceName}`
        + `  ${String(counts.onlyOther).padStart(6)} only in ${source}`);
}

process.exitCode = disagreed === 0 ? 0 : 1;
