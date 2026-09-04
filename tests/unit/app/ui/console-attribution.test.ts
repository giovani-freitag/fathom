import { describe, expect, it } from 'vitest';
import { namesTheSource } from '../../../../src/app/ui/console-attribution.ts';
import type { AddonLogLine } from '../../../../src/app/addons/addon-console.ts';

const printed = (from: string): AddonLogLine => ({ level: 'log', text: 'x', from, repeats: 1 });

describe('whether the console says which reading printed a line', () => {
    it('leaves the open reading\'s own lines bare', () => {
        expect(namesTheSource([printed('Pressure'), printed('Pressure')], 'Pressure')).toBe(false);
    });

    it('names them once a second reading is printing too', () => {
        expect(namesTheSource([printed('Pressure'), printed('Yesterday')], 'Pressure')).toBe(true);
    });

    it('names a line left behind by a reading that is no longer open', () => {
        // Bare beside a reading that printed nothing, output from a reading
        // since closed reads as that reading's own — the reader is looking at
        // an answer about code they can no longer see.
        expect(namesTheSource([printed('Noisy')], 'All blank')).toBe(true);
    });

    it('says nothing about lines printed before a reading had a name', () => {
        expect(namesTheSource([printed(''), printed('')], 'All blank')).toBe(false);
    });

    it('has nothing to name when nothing has printed', () => {
        expect(namesTheSource([], 'All blank')).toBe(false);
    });
});
