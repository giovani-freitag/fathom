import { afterEach, describe, expect, it, vi } from 'vitest';
import { newId } from '../../../src/app/core/new-id.ts';

/** The shape anything that stores one of these reads it back by. */
const VERSION_FOUR = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newId', () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    it('is made without the call a secure context gates', () => {
        // A page served over plain HTTP from a home network — which is how the
        // chart is read from a phone — has no `crypto.randomUUID` at all. Every
        // attempt to draw threw there, with nothing on screen to say why.
        vi.stubGlobal('crypto', {
            getRandomValues: (bytes: Uint8Array) => bytes.fill(7),
        });

        expect(newId()).toMatch(VERSION_FOUR);
    });

    it('names each thing something of its own', () => {
        const made = new Set(Array.from({ length: 200 }, () => newId()));

        expect(made.size).toBe(200);
    });

    it('carries the version and variant, not merely the shape', () => {
        // Every byte the same, so the two the standard fixes are the only ones
        // that can differ — and a build that copied the bytes straight through
        // would spell them out as sevens here.
        vi.stubGlobal('crypto', {
            getRandomValues: (bytes: Uint8Array) => bytes.fill(0xff),
        });

        expect(newId()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    });
});
