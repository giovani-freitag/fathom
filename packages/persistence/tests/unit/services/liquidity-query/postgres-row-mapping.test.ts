import { describe, expect, it } from 'vitest';
import {
    toDepthLadder,
    toQuantityArray,
} from '../../../../src/services/liquidity-query/postgres-row-mapping.ts';

describe('toQuantityArray', () => {
    it('converts a parsed numeric array', () => {
        const quantities = toQuantityArray([1.5, 0, 3.25]);

        expect([...quantities]).toEqual([1.5, 0, 3.25]);
    });

    it('parses the raw array literal a driver without a float parser returns', () => {
        const quantities = toQuantityArray('{1.5,0,3.25}');

        expect([...quantities]).toEqual([1.5, 0, 3.25]);
    });

    it('reads an empty array literal as no quantities', () => {
        const quantities = toQuantityArray('{}');

        expect(quantities.length).toBe(0);
    });

    it('rejects a column that is neither an array nor a literal', () => {
        expect(() => toQuantityArray(42)).toThrow(TypeError);
    });
});

describe('toDepthLadder', () => {
    it('pairs the offset with the parsed quantities', () => {
        const ladder = toDepthLadder(7_894, [2, 4]);

        expect([ladder.lowestBucketIndex, [...ladder.quantities]]).toEqual([7_894, [2, 4]]);
    });
});
