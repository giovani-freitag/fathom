import type { CollectorConfiguration } from './core/collector-configuration.ts';
import type { CollectorLog } from './core/collector-log.ts';
import { CollectorRuntime } from './collector-runtime.ts';
import { describeError } from './core/collector-log.ts';
import type { RecordedContract, RecordingControl } from '../shared/core/recording-control.ts';
import type { LiquidityArchive } from '../database/services/liquidity-archive.ts';
import type { MarketDataSocketFactory } from './core/market-data-socket.ts';
import { releaseTimerFromEventLoop, type TimerHandle } from './core/collector-timers.ts';

export interface CollectorSupervisorConfig {
    readonly control: RecordingControl;
    readonly archive: LiquidityArchive;
    readonly openSocket: MarketDataSocketFactory;
    readonly log: CollectorLog;
    /** Recording settings every contract shares; the grid comes from the registry. */
    readonly shared: Omit<CollectorConfiguration, 'instrumentSymbol' | 'priceBucketSize' | 'frameIntervalMs'>;
    readonly framesPerFlush: number;
    /** How often the enabled set and the disk budget are re-read. */
    readonly reconcileIntervalMs: number;
}

/**
 * Keeps one collector running per enabled contract, and the disk within budget.
 */
export class CollectorSupervisor {
    private readonly config: CollectorSupervisorConfig;
    private readonly running = new Map<string, CollectorRuntime>();
    private reconcileTimer: TimerHandle | null = null;
    private isReconciling = false;
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
        await this.reconcile();

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
            await runtime.stop();
            this.running.delete(symbol);
        }
        await this.config.archive.close();
    }

    /** Which contracts are being recorded right now. */
    get recording(): readonly string[] {
        return [...this.running.keys()];
    }

    private handleReconcileDue(): void {
        void this.reconcile();
    }

    /**
     * Closes the difference between what is running and what should be.
     */
    private async reconcile(): Promise<void> {
        if (this.isReconciling || this.wasStopped) {
            return;
        }
        this.isReconciling = true;

        try {
            const registered = await this.config.control.listContracts();
            await this.stopDisabled(registered);
            await this.startEnabled(registered);
            await this.enforceBudget();
        } catch (error) {
            this.config.log.warning(`Could not reconcile the recording: ${describeError(error)}`);
        } finally {
            this.isReconciling = false;
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
            await runtime.stop();
            this.running.delete(symbol);
            this.config.log.info(`Stopped recording ${symbol}`);
        }
    }

    private async startEnabled(registered: readonly RecordedContract[]): Promise<void> {
        for (const instrument of registered) {
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
                log: this.config.log,
            });

            try {
                await runtime.start();
                this.running.set(instrument.instrumentSymbol, runtime);
            } catch (error) {
                // One venue refusing must not stop the others: the next
                // reconcile tries again, and every other contract keeps writing.
                this.config.log.warning(
                    `Could not start ${instrument.instrumentSymbol}: ${describeError(error)}`,
                );
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
            this.config.log.warning(
                `Dropped ${dropped} of the oldest partitions to stay inside the disk budget`,
            );
        }
    }
}
