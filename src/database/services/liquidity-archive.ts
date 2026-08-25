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

/**
 * Where a collector puts what it recorded, whatever engine is underneath.
 *
 * Declared in its own file rather than beside the PostgreSQL implementation for
 * a reason that is easy to miss: a project that pulls in that implementation
 * pulls in `@types/pg`, which references `@types/node`, which quietly makes
 * every Node global typecheck. A browser build importing this port stays honest
 * about what its platform actually has.
 *
 * Every method must be idempotent on the natural key of what it writes. A
 * collector retries a failed batch, and a restart replays the second it was in
 * the middle of; both have to converge rather than duplicate.
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
 *
 * `isStorageExhausted` separates the two cases a caller must treat differently:
 * a transient fault worth retrying, and a full disk or spent quota where
 * retrying forever only buries the reason.
 */
export class ArchiveUnavailableError extends Error {
    readonly isStorageExhausted: boolean;

    constructor(message: string, isStorageExhausted: boolean, options?: ErrorOptions) {
        super(message, options);
        this.name = 'ArchiveUnavailableError';
        this.isStorageExhausted = isStorageExhausted;
    }
}
