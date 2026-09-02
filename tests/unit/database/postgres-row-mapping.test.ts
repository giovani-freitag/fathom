import { describe, expect, it } from 'vitest';
import {
    parseQuantityLiteral,
    toQuantityArray,
} from '../../../src/database/postgres/postgres-row-mapping.ts';

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

describe('parseQuantityLiteral', () => {
    it('reads an empty array', () => {
        expect(parseQuantityLiteral('{}')).toEqual(new Float32Array(0));
    });

    it('reads a single value', () => {
        expect([...parseQuantityLiteral('{4.5}')]).toEqual([4.5]);
    });

    it('reads every value in order', () => {
        expect([...parseQuantityLiteral('{1,2.5,0,7}')]).toEqual([1, 2.5, 0, 7]);
    });

    it('returns a typed array rather than a boxed one', () => {
        expect(parseQuantityLiteral('{1,2}')).toBeInstanceOf(Float32Array);
    });

    it('agrees with the driver-shaped path on the same values', () => {
        expect([...parseQuantityLiteral('{1,2.5,0}')]).toEqual([...toQuantityArray([1, 2.5, 0])]);
    });

    it('keeps a value the driver wrote in exponent form', () => {
        expect([...parseQuantityLiteral('{1e-3}')]).toEqual([Math.fround(0.001)]);
    });
});

describe('toQuantityArray when the driver already produced a typed array', () => {
    it('passes it through without copying', () => {
        const quantities = Float32Array.from([1, 2, 3]);

        expect(toQuantityArray(quantities)).toBe(quantities);
    });
});
