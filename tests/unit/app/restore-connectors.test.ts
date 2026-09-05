import { afterEach, describe, expect, it } from 'vitest';
import { restoreInstalledConnectors } from '../../../src/app/core/service-container.ts';
import { forgetConnector, listConnectors } from '../../../src/shared/venues/venue-registry.ts';
import type { StoredConnector } from '../../../src/shared/core/stored-connector.ts';

const NOW_MS = 1_700_000_000_000;

/** A whole connector across two files, as the compiler emits it. */
const ACROSS_TWO_FILES: StoredConnector = {
    id: 'kucoin',
    name: 'kucoin',
    installedAtMs: NOW_MS,
    files: {
        'main.ts': `
            const parse = require('./reading/parse.js');
            exports.default = {
                declaration: { book: null, tape: null, bars: null },
                instruments: {
                    planInstruments: () => ({ url: 'https://api.kucoin.test/symbols' }),
                    readInstruments: parse.readInstruments,
                },
                planStream: null, book: null, tape: null, bars: null,
            };
        `,
        'reading/parse.ts': 'exports.readInstruments = () => [];',
    },
};

/** Whatever a test wants the reader's preferences to have held. */
function preferencesHolding(connectors: readonly StoredConnector[]) {
    return { read: () => ({ connectorSources: connectors } as never) };
}

afterEach(() => { forgetConnector('kucoin'); });

describe('putting a reader\'s venues back when the page opens', () => {
    it('rebuilds one written across more than one file', () => {
        // The defect this locks: keeping only the entry file left the venue in
        // storage and out of the picker, with nothing said about why.
        restoreInstalledConnectors(preferencesHolding([ACROSS_TWO_FILES]));

        expect(listConnectors().map(([id]) => id)).toContain('kucoin');
    });

    it('leaves out one that no longer builds, rather than failing later', () => {
        restoreInstalledConnectors(preferencesHolding([{
            ...ACROSS_TWO_FILES,
            files: { 'main.ts': 'exports.default = { this is not code };' },
        }]));

        expect(listConnectors().map(([id]) => id)).not.toContain('kucoin');
    });

    it('leaves out one whose entry reaches a file that is no longer there', () => {
        restoreInstalledConnectors(preferencesHolding([{
            ...ACROSS_TWO_FILES,
            files: { 'main.ts': ACROSS_TWO_FILES.files['main.ts']! },
        }]));

        expect(listConnectors().map(([id]) => id)).not.toContain('kucoin');
    });
});
