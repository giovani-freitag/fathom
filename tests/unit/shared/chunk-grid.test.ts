import { describe, expect, it } from 'vitest';
import {
    chooseDetailLevel,
    columnsPerCell,
    COLUMNS_PER_CHUNK,
    LEVEL_COUNT,
    priceBlocksAcross,
    ROWS_PER_CHUNK,
    toChunkAddress,
    toColumnIndex,
    toColumnStartMs,
} from '../../../src/shared/codec/chunk-grid.ts';

const SECOND_MS = 1_000;

describe('columnsPerCell', () => {
    it('folds nothing at the finest level', () => {
        expect(columnsPerCell(0)).toBe(1);
    });

    it('folds by the same factor at every step up', () => {
        expect([columnsPerCell(1), columnsPerCell(2), columnsPerCell(3)]).toEqual([4, 16, 64]);
    });
});

describe('chooseDetailLevel', () => {
    it('reads the finest level when every instant has a column of its own', () => {
        expect(chooseDetailLevel({ spanMs: 900 * SECOND_MS, columnIntervalMs: SECOND_MS, maxColumns: 1_900 })).toBe(0);
    });

    it('steps up once the reader can no longer draw every instant', () => {
        // Four seconds to a column is exactly one cell of the level above.
        expect(chooseDetailLevel({ spanMs: 7_600 * SECOND_MS, columnIntervalMs: SECOND_MS, maxColumns: 1_900 })).toBe(1);
    });

    it('takes a level a little coarser than asked rather than four times the work', () => {
        // Levels step by four. Refused for being a tenth too coarse, the level
        // below costs four times the stored columns to unpack for a picture
        // nobody can tell apart once it is scaled to the plot. Measured on a
        // four hour window over the whole book, that cliff was the difference
        // between about two hundred milliseconds and about a second.
        expect(chooseDetailLevel({
            spanMs: 6_800 * SECOND_MS, columnIntervalMs: SECOND_MS, maxColumns: 1_900,
        })).toBe(1);
    });

    it('will not take one more than twice as coarse as asked', () => {
        expect(chooseDetailLevel({
            spanMs: 3_700 * SECOND_MS, columnIntervalMs: SECOND_MS, maxColumns: 1_900,
        })).toBe(0);
    });

    it('climbs as far as a month needs and no further', () => {
        const month = 30 * 24 * 3_600 * SECOND_MS;

        expect(chooseDetailLevel({ spanMs: month, columnIntervalMs: SECOND_MS, maxColumns: 1_900 })).toBe(LEVEL_COUNT - 1);
    });

    it('never asks for a level that is not kept', () => {
        const century = 100 * 365 * 24 * 3_600 * SECOND_MS;

        expect(chooseDetailLevel({ spanMs: century, columnIntervalMs: SECOND_MS, maxColumns: 1_900 })).toBe(LEVEL_COUNT - 1);
    });

    it('reads the finest level rather than nothing when the reader has no room', () => {
        expect(chooseDetailLevel({ spanMs: 900 * SECOND_MS, columnIntervalMs: SECOND_MS, maxColumns: 0 })).toBeLessThan(LEVEL_COUNT);
    });
});

describe('toChunkAddress', () => {
    it('puts the first instants and prices in the first chunk', () => {
        expect(toChunkAddress(0, 0, 0)).toEqual({ detailLevel: 0, timeBlock: 0, priceBlock: 0 });
    });

    it('crosses into the next chunk exactly at the boundary', () => {
        expect(toChunkAddress(0, COLUMNS_PER_CHUNK, ROWS_PER_CHUNK))
            .toEqual({ detailLevel: 0, timeBlock: 1, priceBlock: 1 });
    });

    it('keeps the last instant before a boundary in the earlier chunk', () => {
        expect(toChunkAddress(0, COLUMNS_PER_CHUNK - 1, ROWS_PER_CHUNK - 1))
            .toEqual({ detailLevel: 0, timeBlock: 0, priceBlock: 0 });
    });
});

describe('priceBlocksAcross', () => {
    it('names one block for a band inside one', () => {
        expect(priceBlocksAcross(10, 20)).toEqual([0]);
    });

    it('names every block a band reaches into', () => {
        expect(priceBlocksAcross(ROWS_PER_CHUNK - 1, 3)).toEqual([0, 1]);
    });

    it('names the block a band of nothing sits in rather than none at all', () => {
        // A reader asking for an empty band still has a place on the grid, and
        // answering with no blocks would read as a stretch nobody recorded.
        expect(priceBlocksAcross(ROWS_PER_CHUNK, 0)).toEqual([1]);
    });
});

describe('placing a column in time', () => {
    it('reads a level-nought column back as the instant it covered', () => {
        expect(toColumnStartMs(0, 5, SECOND_MS)).toBe(5_000);
    });

    it('reads a coarse column back as the first instant it folded', () => {
        expect(toColumnStartMs(1, 5, SECOND_MS)).toBe(20_000);
    });

    it('puts an instant back in the column that folded it', () => {
        // Round-trip: every instant a column covers has to land on that column,
        // or a window read back is drawn a cell off from where it happened.
        for (const instantMs of [20_000, 21_000, 22_000, 23_000]) {
            expect(toColumnIndex(1, instantMs, SECOND_MS)).toBe(5);
        }
    });

    it('starts the next column at the next instant it does not cover', () => {
        expect(toColumnIndex(1, 24_000, SECOND_MS)).toBe(6);
    });
});
