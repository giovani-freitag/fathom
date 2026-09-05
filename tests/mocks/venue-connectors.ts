import type {
    BookReader,
    TapeReader,
    BarReader,
    VenueConnector,
} from '../../src/shared/core/venue-connector.ts';
import type { VenueDeclaration } from '../../src/shared/core/venue-plan.ts';

/**
 * A connector that reads exactly what its declaration claims.
 *
 * Built from the declaration rather than written out beside it, so that a test
 * cannot accidentally register the contradiction the registry exists to catch —
 * and so a test that wants one has to say so.
 *
 * @param declaration - What the venue is being said to do.
 * @returns A connector the registry accepts, whose readers answer nothing.
 */
export function buildConnector(declaration: VenueDeclaration): VenueConnector {
    return {
        declaration,
        instruments: {
            planInstruments: () => ({ url: 'https://example.test/instruments' }),
            readInstruments: () => [],
        },
        planStream: declaration.book === null && declaration.tape === null
            ? null
            : () => ({ url: 'wss://example.test/stream' }),
        book: declaration.book === null ? null : SILENT_BOOK,
        tape: declaration.tape === null ? null : SILENT_TAPE,
        bars: declaration.bars === null ? null : SILENT_BARS,
    };
}

const SILENT_BOOK: BookReader = {
    planSnapshot: () => ({ url: 'https://example.test/depth' }),
    readSnapshot: () => ({ lastUpdateId: 0, bidLevels: [], askLevels: [] }),
    readUpdate: () => null,
};

const SILENT_TAPE: TapeReader = { readTrades: () => [] };

const SILENT_BARS: BarReader = {
    planPage: () => ({ url: 'https://example.test/candles' }),
    readPage: () => [],
};
