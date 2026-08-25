import type { LiquidityFrame } from '../../shared/core/liquidity-frame.ts';
import type { RecordingGap } from '../../shared/core/recording-gap.ts';
import type { TradeCluster } from '../../shared/core/trade-cluster.ts';

export interface FrameAppendRequest {
    readonly instrumentSymbol: string;
    readonly priceBucketSize: number;
    readonly frames: readonly LiquidityFrame[];
}

export interface TradeClusterAppendRequest {
    readonly instrumentSymbol: string;
    readonly priceBucketSize: number;
    readonly clusters: readonly TradeCluster[];
}

export interface InstrumentRegistrationRequest {
    readonly instrumentSymbol: string;
    readonly priceBucketSize: number;
    readonly frameIntervalMs: number;
}

export interface GapRecordRequest {
    readonly instrumentSymbol: string;
    readonly gap: RecordingGap;
}

// Declared apart from the PostgreSQL implementation on purpose: a browser
// project that imports that file imports `@types/pg`, which references
// `@types/node`, and every Node global silently starts typechecking.
/**
 * Where a collector puts what it recorded, whatever engine is underneath.
 */
export interface LiquidityArchive {
    /** Acquires whatever the engine needs before it can accept writes. */
    open(): Promise<void>;
    /** Releases it. Safe to call in any state. */
    close(): Promise<void>;
    registerInstrument(request: InstrumentRegistrationRequest): Promise<void>;
    appendFrames(request: FrameAppendRequest): Promise<void>;
    appendTradeClusters(request: TradeClusterAppendRequest): Promise<void>;
    recordGap(request: GapRecordRequest): Promise<void>;
    /** Instant of the newest recorded frame, or null when nothing is stored. */
    findLastFrameTimestamp(instrumentSymbol: string): Promise<number | null>;
}

/**
 * Raised when the archive will not accept a write.
 */
export class ArchiveUnavailableError extends Error {
    readonly isStorageExhausted: boolean;

    constructor(message: string, isStorageExhausted: boolean, options?: ErrorOptions) {
        super(message, options);
        this.name = 'ArchiveUnavailableError';
        this.isStorageExhausted = isStorageExhausted;
    }
}
