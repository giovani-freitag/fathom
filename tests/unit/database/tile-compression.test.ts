import { describe, expect, it } from 'vitest';
import {
    compressFillingPlane,
    compressPlane,
    decompressPlane,
} from '../../../src/database/services/tile-compression.ts';

describe('tile compression', () => {
    /** A plane shaped the way a picture of a book is: long runs of the same byte. */
    const plane = Uint8Array.from(
        { length: 8_192 },
        (_, index) => (index % 512 < 400 ? 0 : 40 + (index % 7)),
    );

    it('gives back exactly what it was given', () => {
        expect([...decompressPlane(compressPlane(plane))]).toEqual([...plane]);
    });

    it('squeezes a picture that repeats itself harder than the cheap setting would', () => {
        // The cheapest setting already reaches about sixty times on a plane
        // this repetitive, so a looser bound than this asserts nothing about
        // the setting actually chosen.
        expect(plane.byteLength / compressPlane(plane).byteLength).toBeGreaterThan(100);
    });

    it('carries an empty plane rather than refusing one', () => {
        expect(decompressPlane(compressPlane(new Uint8Array(0)))).toHaveLength(0);
    });

    it('carries a plane with nothing repeated in it', () => {
        const noisy = Uint8Array.from({ length: 1_024 }, (_, index) => (index * 37) % 251);

        expect([...decompressPlane(compressPlane(noisy))]).toEqual([...noisy]);
    });

    it('reads a plane of a picture still filling back unchanged', () => {
        // The cheaper squeeze changes what it costs and how big it comes out,
        // never what it holds: the reader cannot tell which one wrote it.
        const plane = Uint8Array.from({ length: 4_000 }, (_, index) => (index % 91 < 60 ? 0 : index % 7));

        expect([...decompressPlane(compressFillingPlane(plane))]).toEqual([...plane]);
    });

    it('spends less on a picture still filling than on a finished one', () => {
        // Measured on the write path, squeezing hard was four fifths of what it
        // cost; a picture still filling is written over within seconds and only
        // the version that completes it is kept. Size is the proxy here because
        // a clock in a test is a flake waiting to happen: the cheaper setting
        // trades exactly these bytes for exactly that time.
        const plane = Uint8Array.from({ length: 40_000 }, (_, index) => (index % 91 < 60 ? 0 : index % 7));

        expect(compressFillingPlane(plane).length).toBeGreaterThan(compressPlane(plane).length);
    });
});
