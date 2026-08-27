/**
 * Positional placeholder list for a multi-row `VALUES` clause.
 *
 * @param rowCount - Number of tuples to emit.
 * @param columnCount - Number of columns in each tuple.
 * @returns A clause such as `($1, $2), ($3, $4)`, empty when `rowCount` is zero.
 */
export function buildValuesClause(rowCount: number, columnCount: number): string {
    const tuples: string[] = [];
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
        const placeholders: string[] = [];
        for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
            placeholders.push(`$${rowIndex * columnCount + columnIndex + 1}`);
        }
        tuples.push(`(${placeholders.join(', ')})`);
    }
    return tuples.join(', ');
}

/**
 * Splits a list into consecutive slices of at most `chunkSize` items.
 *
 * @param items - Items to split.
 * @param chunkSize - Maximum items per slice.
 * @returns Slices in original order, empty when `items` is empty.
 * @throws RangeError when a slice could hold nothing.
 */
export function chunkItems<TItem>(items: readonly TItem[], chunkSize: number): TItem[][] {
    // A slice of nothing never advances the cursor, and this runs on the path
    // that writes the archive: the collector would hang holding frames nothing
    // else has a copy of.
    if (chunkSize < 1) {
        throw new RangeError(`A chunk must hold at least one item, not ${chunkSize}`);
    }

    const chunks: TItem[][] = [];
    for (let startIndex = 0; startIndex < items.length; startIndex += chunkSize) {
        chunks.push(items.slice(startIndex, startIndex + chunkSize));
    }
    return chunks;
}
