import { Connector } from '../../src/shared/core/venue-connector.ts';
import type { DepthSnapshot } from '../../src/shared/core/depth-types.ts';
import type {
    VenueConnector,
    VenueInstrument,
    VenueRequest,
    VenueStreamPlan,
} from '../../src/shared/core/venue-connector.ts';
import type { VenueDeclaration } from '../../src/shared/core/venue-plan.ts';

/**
 * A connector that answers exactly what its declaration claims.
 *
 * Built from the declaration rather than written out beside it, so that a test
 * cannot accidentally register the contradiction the registry exists to catch —
 * and so a test that wants one has to say so.
 *
 * The methods are put on the instance rather than written on a subclass because
 * which of them exist is what the declaration decides, and a class can only
 * declare that once.
 *
 * @param declaration - What the venue is being said to do.
 * @returns A connector the registry accepts, whose readers answer nothing.
 */
export function buildConnector(declaration: VenueDeclaration): VenueConnector {
    const built = new Silent(declaration);

    if (declaration.book !== null || declaration.tape !== null) {
        built.planStream = (): VenueStreamPlan => ({ url: 'wss://example.test/stream' });
    }
    if (declaration.book !== null) {
        built.planSnapshot = (): VenueRequest => ({ url: 'https://example.test/depth' });
        built.readSnapshot = (): DepthSnapshot => ({ lastUpdateId: 0, bidLevels: [], askLevels: [] });
        built.readUpdate = () => null;
    }
    if (declaration.tape !== null) {
        built.readTrades = () => [];
    }
    if (declaration.bars !== null) {
        built.planBars = (): VenueRequest => ({ url: 'https://example.test/candles' });
        built.readBars = () => [];
    }

    return built;
}

/** A venue that lists nothing and answers nothing beyond what it was given. */
class Silent extends Connector {
    readonly declaration: VenueDeclaration;

    constructor(declaration: VenueDeclaration) {
        super();
        this.declaration = declaration;
    }

    planInstruments(): VenueRequest {
        return { url: 'https://example.test/instruments' };
    }

    readInstruments(): readonly VenueInstrument[] {
        return [];
    }
}
