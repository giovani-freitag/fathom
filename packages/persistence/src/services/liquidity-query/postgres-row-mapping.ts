import type { DepthLadder } from '@fathom/contracts';

/**
 * Converts a `REAL[]` column into the dense typed array the renderer consumes.
 *
 * The driver normally parses float arrays into numbers, but falls back to the
 * raw `{1,2,3}` literal when no parser is registered for the element type. Both
 * shapes are accepted so a driver upgrade cannot silently produce NaN depth.
 *
 * @param column - Value the driver produced for a `REAL[]` column.
 * @returns The quantities, in column order.
 * @throws TypeError when the column is neither an array nor an array literal.
 */
export function toQuantityArray(column: unknown): Float32Array {
    if (Array.isArray(column)) {
        return Float32Array.from(column as number[], Number);
    }
    if (typeof column === 'string') {
        return parseArrayLiteral(column);
    }
    throw new TypeError(`Expected a REAL[] column, received ${typeof column}`);
}

/**
 * Builds one side of a depth ladder from its offset and quantity columns.
 *
 * @param lowestBucketIndex - Absolute index of the first quantity.
 * @param quantityColumn - Value the driver produced for the quantity column.
 * @returns The ladder for that side.
 */
export function toDepthLadder(lowestBucketIndex: number, quantityColumn: unknown): DepthLadder {
    return { lowestBucketIndex, quantities: toQuantityArray(quantityColumn) };
}

function parseArrayLiteral(literal: string): Float32Array {
    const body = literal.trim().replace(/^\{/, '').replace(/\}$/, '');
    if (body === '') {
        return new Float32Array(0);
    }
    return Float32Array.from(body.split(','), Number);
}
