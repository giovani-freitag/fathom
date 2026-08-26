import type {
    FrameAppendRequest,
    GapRecordRequest,
    InstrumentRegistrationRequest,
    LiquidityArchive,
    TradeClusterAppendRequest,
} from './liquidity-archive.ts';

export interface NotifyingLiquidityArchiveConfig {
    readonly archive: LiquidityArchive;
    /** Called after a write lands, with the contract that grew. */
    readonly onWritten: (instrumentSymbol: string) => void;
}

/**
 * An archive that says which contract it just wrote to.
 *
 * The nudge a reader needs, from the one place that knows a write succeeded.
 * On a server the same signal crosses processes as a database notification; in
 * a page the writer and the reader are the same worker, so it is a call.
 */
export class NotifyingLiquidityArchive implements LiquidityArchive {
    private readonly config: NotifyingLiquidityArchiveConfig;

    constructor(config: NotifyingLiquidityArchiveConfig) {
        this.config = config;
    }

    open(): Promise<void> {
        return this.config.archive.open();
    }

    close(): Promise<void> {
        return this.config.archive.close();
    }

    registerInstrument(request: InstrumentRegistrationRequest): Promise<void> {
        return this.config.archive.registerInstrument(request);
    }

    /**
     * Appends frames and announces the contract they belong to.
     *
     * @param request - The instrument, its grid, and the frames.
     */
    async appendFrames(request: FrameAppendRequest): Promise<void> {
        await this.config.archive.appendFrames(request);
        // Announced after the write, never before: a reader told to catch up on
        // a write that then failed would read nothing and move its cursor past
        // the range it was meant to fetch.
        this.config.onWritten(request.instrumentSymbol);
    }

    appendTradeClusters(request: TradeClusterAppendRequest): Promise<void> {
        return this.config.archive.appendTradeClusters(request);
    }

    async recordGap(request: GapRecordRequest): Promise<void> {
        await this.config.archive.recordGap(request);
        this.config.onWritten(request.instrumentSymbol);
    }

    findLastFrameTimestamp(instrumentSymbol: string): Promise<number | null> {
        return this.config.archive.findLastFrameTimestamp(instrumentSymbol);
    }
}
