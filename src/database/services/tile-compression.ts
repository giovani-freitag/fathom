import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';

/**
 * How a plane is squeezed on its way to storage.
 *
 * Brotli rather than gzip, and not by taste: measured over a recorded book on
 * the layout this project already writes, the same bytes come out a third
 * smaller for the cost of one import. That is more than any rearranging of the
 * picture bought, and it costs nothing to read back.
 *
 * One below the highest quality, which is not a compromise but a measurement:
 * on a plane the size this writes, the top setting costs six milliseconds
 * against well under one and buys a single byte in seventy-seven. This runs on
 * the capture path, where six milliseconds an instant is time the recording
 * does not have.
 */
const BROTLI_OPTIONS = {
    params: {
        [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY - 2,
    },
} as const;

/**
 * How a plane is squeezed when it is about to be written over.
 *
 * A picture still filling is rewritten every few columns, and only its last
 * version is ever kept — every earlier one is overwritten within seconds.
 * Squeezing those hard is work spent on bytes nobody keeps: measured over a
 * recorded book, the cheapest setting costs a fifth of the time and the tile
 * that finally survives comes out exactly the same size.
 */
const DRAFT_BROTLI_OPTIONS = {
    params: {
        [constants.BROTLI_PARAM_QUALITY]: 1,
    },
} as const;

/**
 * Squeezes one plane for storage.
 *
 * @param plane - The bytes to store.
 * @returns The stored form.
 */
export function compressPlane(plane: Uint8Array): Buffer {
    return brotliCompressSync(plane, BROTLI_OPTIONS);
}

/**
 * Squeezes one plane of a picture that is still filling.
 *
 * Reads back the way every other plane does — the setting changes what the
 * squeeze costs and how big it comes out, never what it holds.
 *
 * @param plane - The bytes to store until the next rewrite replaces them.
 * @returns The stored form.
 */
export function compressFillingPlane(plane: Uint8Array): Buffer {
    return brotliCompressSync(plane, DRAFT_BROTLI_OPTIONS);
}

/**
 * Reads one stored plane back.
 *
 * One squeeze, because the archive holds one: what gzip wrote before this was
 * brotli has been rewritten. The stored bytes carry no version of their own, so
 * a second change to this would have to rewrite the archive again — and until
 * it did, every reader would owe both formats for ever. A plane that will not
 * open is skipped by the reader above rather than refusing the whole window,
 * which is what keeps that mistake from blanking a chart.
 *
 * @param stored - What came out of the archive.
 * @returns The plane it was made from.
 */
export function decompressPlane(stored: Buffer): Uint8Array {
    return new Uint8Array(brotliDecompressSync(stored));
}
