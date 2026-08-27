import { describe, expect, it } from 'vitest';
import {
    buildValuesClause,
    chunkItems,
} from '../../../src/database/postgres/multi-row-insert.ts';

describe('buildValuesClause', () => {
    it('numbers placeholders continuously across rows', () => {
        const clause = buildValuesClause(2, 3);

        expect(clause).toBe('($1, $2, $3), ($4, $5, $6)');
    });

    it('returns an empty clause for no rows', () => {
        const clause = buildValuesClause(0, 4);

        expect(clause).toBe('');
    });

    it('emits exactly one placeholder per bound value', () => {
        const clause = buildValuesClause(7, 9);

        expect(clause.match(/\$\d+/g)?.length).toBe(63);
    });
});

describe('chunkItems', () => {
    it('splits into consecutive slices of the requested size', () => {
        const chunks = chunkItems([1, 2, 3, 4, 5], 2);

        expect(chunks).toEqual([[1, 2], [3, 4], [5]]);
    });

    it('returns nothing for an empty list', () => {
        const chunks = chunkItems([], 10);

        expect(chunks).toEqual([]);
    });

    it('keeps a list shorter than the chunk size whole', () => {
        const chunks = chunkItems([1, 2], 500);

        expect(chunks).toEqual([[1, 2]]);
    });

    it('preserves the original order across chunks', () => {
        const chunks = chunkItems([1, 2, 3, 4, 5, 6, 7], 3);

        expect(chunks.flat()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });

    it('refuses a slice that could hold nothing', () => {
        // Left to loop, the cursor never advances and the collector hangs holding
        // frames nothing else has a copy of.
        expect(() => chunkItems([1, 2, 3], 0)).toThrow(RangeError);
    });
});
