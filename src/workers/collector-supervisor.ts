import type { CollectorConfiguration } from './core/collector-configuration.ts';
import type { CollectorLog } from './core/collector-log.ts';
import { CollectorRuntime } from './collector-runtime.ts';
import type { WideRecordingConfig } from './services/liquidity-recorder-service.ts';
import { describeError } from './core/collector-log.ts';
import type { RecordedContract, RecordingControl } from '../shared/core/recording-control.ts';
import type { LiquidityArchive } from '../database/services/liquidity-archive.ts';
import type { MarketDataSocketFactory } from './core/market-data-socket.ts';
import { releaseTimerFromEventLoop, type TimerHandle } from '../shared/core/timers.ts';

export interface CollectorSupervisorConfig {
    readonly control: RecordingControl;
    readonly archive: LiquidityArchive;
    readonly openSocket: MarketDataSocketFactory;
    readonly log: CollectorLog;
    /** Recording settings every contract shares; the grid comes from the registry. */
    readonly shared: Omit<CollectorConfiguration, 'instrumentSymbol' | 'priceBucketSize' | 'frameIntervalMs'>;
    readonly framesPerFlush: number;
    /**
     * Builds the wide recording for one contract, when there is to be one.
     *
     * A function rather than a value because each contract frames its own far
     * field and writes it under its own name.
     */
    readonly buildWideRecordings?: (
        instrumentSymbol: string,
        priceBucketSize: number,
    ) => readonly WideRecordingConfig[];
    /** How often the enabled set and the disk budget are re-read. */
    readonly reconcileIntervalMs: number;
    /**
     * Silence after which a collector is treated as stopped and replaced.
     *
     * The recording clock ticks every second whatever the market does, so
     * silence here is never a quiet contract — it is a runtime that died.
     */
    readonly stallTimeoutMs: number;
    /** Reads the wall clock, so a test can move it. */
    readonly readNowMs: () => number;
}

/**
 * Keeps one collector running per enabled contract, and the disk within budget.
 */
export class CollectorSupervisor {
    private readonly config: CollectorSupervisorConfig;
    private readonly running = new Map<string, CollectorRuntime>();
    /** When each runtime was started, which is its liveness before its first frame. */
    private readonly startedAtMs = new Map<string, number>();
    private reconcileTimer: TimerHandle | null = null;
    private reconcilePass: Promise<void> | null = null;
    private wasStopped = false;

    constructor(config: CollectorSupervisorConfig) {
        this.config = config;
        this.handleReconcileDue = this.handleReconcileDue.bind(this);
    }

    /**
     * Opens the archive and brings every enabled contract up.
     *
     * @throws ArchiveUnavailableError when the archive cannot be reached.
     */
    async start(): Promise<void> {
        await this.config.archive.open();
        await this.reconcileNow();

        this.reconcileTimer = setInterval(this.handleReconcileDue, this.config.reconcileIntervalMs);
        releaseTimerFromEventLoop(this.reconcileTimer);
    }

    /**
     * Stops every collector and releases the archive.
     */
    async stop(): Promise<void> {
        this.wasStopped = true;
        if (this.reconcileTimer !== null) {
            clearInterval(this.reconcileTimer);
            this.reconcileTimer = null;
        }

        for (const [symbol, runtime] of this.running) {
            await this.discard(symbol, runtime);
        }
        await this.config.archive.close();
    }

    /** Which contracts are being recorded right now. */
    get recording(): readonly string[] {
        return [...this.running.keys()];
    }

    private handleReconcileDue(): void {
        void this.reconcileNow();
    }

    /**
     * Closes the difference between what is running and what should be.
     *
     * @returns Once the pass has finished, or immediately when one is under way.
     */
    async reconcileNow(): Promise<void> {
        if (this.reconcilePass !== null || this.wasStopped) {
            return;
        }
        this.reconcilePass = this.runPass();
        try {
            await this.reconcilePass;
        } finally {
            this.reconcilePass = null;
        }
    }

    /**
     * One pass at closing that difference.
     */
    private async runPass(): Promise<void> {
        try {
            const registered = await this.config.control.listContracts();
            await this.stopDisabled(registered);
            await this.dropStalled();
            await this.startEnabled(registered);
            await this.enforceBudget();
        } catch (error) {
            this.config.log.warning('Could not reconcile the recording', {
                reason: describeError(error),
            });
        }
    }

    private async stopDisabled(registered: readonly RecordedContract[]): Promise<void> {
        const wanted = new Set(
            registered.filter((instrument) => instrument.isEnabled)
                .map((instrument) => instrument.instrumentSymbol),
        );

        for (const [symbol, runtime] of this.running) {
            if (wanted.has(symbol)) {
                continue;
            }
            await this.discard(symbol, runtime);
            this.config.log.info('Stopped recording', { instrumentSymbol: symbol });
        }
    }

    /**
     * Lets go of a collector that stopped recording, so the next pass rebuilds it.
     *
     * Holding the handle was enough to believe it was working: the map recorded
     * that a runtime had been built, never that it was still capturing, so one
     * that died stayed in it until the process itself was restarted.
     */
    private async dropStalled(): Promise<void> {
        const nowMs = this.config.readNowMs();

        for (const [symbol, runtime] of this.running) {
            const lastSignMs = runtime.lastRecordedAtMs ?? this.startedAtMs.get(symbol) ?? nowMs;
            const silentForMs = nowMs - lastSignMs;
            if (silentForMs < this.config.stallTimeoutMs) {
                continue;
            }

            await this.discard(symbol, runtime);
            this.config.log.warning('Collector stopped recording and is being replaced', {
                instrumentSymbol: symbol,
                silentForMs,
            });
        }
    }

    /**
     * Whether shutdown began, read fresh rather than assumed across an await.
     *
     * @returns True once `stop` has been called.
     */
    private hasShutdownBegun(): boolean {
        return this.wasStopped;
    }

    private async discard(symbol: string, runtime: CollectorRuntime): Promise<void> {
        await runtime.stop();
        this.running.delete(symbol);
        this.startedAtMs.delete(symbol);
    }

    private async startEnabled(registered: readonly RecordedContract[]): Promise<void> {
        for (const instrument of registered) {
            if (this.hasShutdownBegun()) {
                return;
            }
            if (!instrument.isEnabled || this.running.has(instrument.instrumentSymbol)) {
                continue;
            }

            const runtime = new CollectorRuntime({
                configuration: {
                    ...this.config.shared,
                    instrumentSymbol: instrument.instrumentSymbol,
                    priceBucketSize: instrument.priceBucketSize,
                    frameIntervalMs: instrument.frameIntervalMs,
                },
                openSocket: this.config.openSocket,
                archive: this.config.archive,
                framesPerFlush: this.config.framesPerFlush,
                ...this.config.buildWideRecordings === undefined
                    ? {}
                    : {
                        wideRecordings: this.config.buildWideRecordings(
                            instrument.instrumentSymbol, instrument.priceBucketSize,
                        ),
                    },
                // Bound to the contract, so every line a runtime writes says
                // which one wrote it. Four collectors share one log.
                log: this.config.log.child({ instrumentSymbol: instrument.instrumentSymbol }),
            });

            try {
                await runtime.start();
                if (this.hasShutdownBegun()) {
                    // Stopped while this one was still coming up. Nothing drains
                    // the running collectors again, so it lets go here or it
                    // holds its socket and its write buffer for good.
                    await runtime.stop();
                    return;
                }
                this.running.set(instrument.instrumentSymbol, runtime);
                this.startedAtMs.set(instrument.instrumentSymbol, this.config.readNowMs());
            } catch (error) {
                // One venue refusing must not stop the others: the next
                // reconcile tries again, and every other contract keeps writing.
                this.config.log.warning('Could not start a collector', {
                    instrumentSymbol: instrument.instrumentSymbol,
                    reason: describeError(error),
                });
                await runtime.stop();
            }
        }
    }

    /**
     * Drops the oldest history when the recording outgrows its disk budget.
     */
    private async enforceBudget(): Promise<void> {
        const dropped = await this.config.control.pruneToBudget();
        if (dropped > 0) {
            this.config.log.warning('Dropped the oldest partitions to stay inside the disk budget', {
                partitions: dropped,
            });
        }
    }
}
