import pMap from 'p-map';
import type { CollectorConfiguration } from './core/collector-configuration.ts';
import type { CollectorLog } from './core/collector-log.ts';
import { CollectorRuntime } from './collector-runtime.ts';
import type { WideRecordingConfig } from './services/liquidity-recorder-service.ts';
import { describeError } from './core/collector-log.ts';
import type { RecordedContract, RecordingControl } from '../shared/core/recording-control.ts';
import type { LiquidityArchive } from '../database/services/liquidity-archive.ts';
import type { MarketDataSocketFactory } from './core/market-data-socket.ts';
import { releaseTimerFromEventLoop, type TimerHandle } from '../shared/core/timers.ts';

/**
 * Whether a contract has been changed in a way a running collector cannot follow.
 *
 * The grid and the rate, which are what a collector writes with. Not the flag:
 * a contract switched off is stopped rather than retuned, and a stop is not a
 * restart.
 *
 * @param held - What the collector was started with.
 * @param asked - What the registry says now.
 * @returns True where the running one is writing something else.
 */
function isRetuned(held: RecordedContract, asked: RecordedContract): boolean {
    // Not the venue: a contract on another venue is another contract, and the
    // key it is held under says so — so it is stopped and started rather than
    // retuned, and comparing it here could never be true.
    return held.priceBucketSize !== asked.priceBucketSize
        || held.frameIntervalMs !== asked.frameIntervalMs;
}

/** One running collector, and everything the passes ask about it. */
interface RunningCollector {
    readonly runtime: CollectorRuntime;
    /** What it was started with, so a contract changed since can be spotted. */
    readonly contract: RecordedContract;
    /** When it started, which is its liveness until its first frame lands. */
    readonly startedAtMs: number;
}

/**
 * What names a contract: the venue and the symbol, never the symbol alone.
 *
 * @param contract - The contract to name.
 * @returns Its key.
 */
function nameContract(contract: RecordedContract): string {
    return `${contract.venue}/${contract.instrumentSymbol}`;
}

/**
 * The last sign of life a collector gave, or the moment it was started.
 *
 * Held in one entry with the runtime, so there is no third state where a
 * collector is running and nothing knows when it started. It used to fall
 * through to the clock — which reads as "alive right now" — for a collector
 * whose start time had gone missing from the second map.
 *
 * @param held - The running collector.
 * @returns When it was last known to be working.
 */
function lastSignOf(held: RunningCollector): number {
    return held.runtime.lastRecordedAtMs ?? held.startedAtMs;
}

/**
 * Collectors let go of at once, and brought up at once.
 *
 * Four, which is what one machine records: enough that a pass is not a queue of
 * handshakes, few enough that a venue is not handed every subscription this
 * process has in the same breath.
 */
const TEARDOWNS_AT_ONCE = 4;

export interface CollectorSupervisorConfig {
    readonly control: RecordingControl;
    readonly archive: LiquidityArchive;
    readonly openSocket: MarketDataSocketFactory;
    readonly log: CollectorLog;
    /** Recording settings every contract shares; the grid comes from the registry. */
    readonly shared: Omit<CollectorConfiguration, 'instrumentSymbol' | 'venue' | 'priceBucketSize' | 'frameIntervalMs'>;
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
    /**
     * One entry per running collector, keyed by the contract it is recording.
     *
     * Keyed by venue and symbol together, because that is what names a
     * contract: two venues both list BTCUSDT, and keyed by the symbol alone the
     * second to be enabled was taken for the first — already running, so never
     * started, and the reader was shown a recording of the wrong market.
     *
     * One entry rather than three parallel maps. Three are three things that
     * can disagree about one collector, and the entry carries everything the
     * passes ask: the runtime, what it was started with — a grid edited in the
     * registry means every column from now on belongs on a different one — and
     * when, which is its liveness before its first frame.
     */
    private readonly running = new Map<string, RunningCollector>();
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

        await this.discardAll([...this.running]);
        await this.config.archive.close();
    }

    /** Which contracts are being recorded right now, by venue and symbol. */
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
        const wanted = new Map(
            registered.filter((instrument) => instrument.isEnabled)
                .map((instrument) => [nameContract(instrument), instrument] as const),
        );

        const dropping = [...this.running].filter(([key]) => !wanted.has(key));
        await this.discardAll(dropping);
        for (const [, held] of dropping) {
            this.config.log.info('Stopped recording', {
                venue: held.contract.venue,
                instrumentSymbol: held.contract.instrumentSymbol,
            });
        }

        // A contract whose grid or rate was changed is let go of here and built
        // again by the same pass. Left alone, it would keep writing the grid it
        // was started on: the archive says which grid each block holds, so what
        // is already stored stays readable, but every new column would be
        // written on a grid nobody asked for any more.
        const restarting = [...this.running].filter(([key, held]) => {
            const asked = wanted.get(key);
            return asked !== undefined && isRetuned(held.contract, asked);
        });

        await this.discardAll(restarting);
        for (const [, held] of restarting) {
            this.config.log.info('Recording again on the grid it was changed to', {
                venue: held.contract.venue,
                instrumentSymbol: held.contract.instrumentSymbol,
            });
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
        const silent = [...this.running].filter(([, held]) => (
            nowMs - lastSignOf(held) >= this.config.stallTimeoutMs
        ));

        await this.discardAll(silent);
        for (const [, held] of silent) {
            this.config.log.warning('Collector stopped recording and is being replaced', {
                venue: held.contract.venue,
                instrumentSymbol: held.contract.instrumentSymbol,
                silentForMs: nowMs - lastSignOf(held),
            });
        }
    }

    /**
     * Lets go of several collectors at once.
     *
     * Together rather than one after another because a close is a socket
     * closing: four of them in a queue is four timeouts end to end, and the
     * pass that has to finish before any recording resumes is behind all of
     * them. Bounded so that a shutdown does not open every teardown at once.
     */
    private async discardAll(held: readonly (readonly [string, RunningCollector])[]): Promise<void> {
        await pMap(held, async ([key, one]) => { await this.discard(key, one); }, {
            concurrency: TEARDOWNS_AT_ONCE,
        });
    }

    /**
     * Whether shutdown began, read fresh rather than assumed across an await.
     *
     * @returns True once `stop` has been called.
     */
    private hasShutdownBegun(): boolean {
        return this.wasStopped;
    }

    private async discard(key: string, held: RunningCollector): Promise<void> {
        await held.runtime.stop();
        this.running.delete(key);
    }

    /**
     * Brings up every enabled contract that is not already recording.
     *
     * Several at a time, because bringing one up is a socket opened and a
     * ladder fetched: in a queue, the fourth contract starts recording three
     * handshakes after the first, and every one of those seconds is a second
     * of book nothing wrote down.
     */
    private async startEnabled(registered: readonly RecordedContract[]): Promise<void> {
        const wanted = registered.filter((instrument) => instrument.isEnabled
            && !this.running.has(nameContract(instrument)));

        await pMap(wanted, async (instrument) => { await this.startOne(instrument); }, {
            concurrency: TEARDOWNS_AT_ONCE,
        });
    }

    /**
     * Brings up one contract, or says why it could not be brought up.
     */
    private async startOne(instrument: RecordedContract): Promise<void> {
        if (this.hasShutdownBegun()) {
            return;
        }

        const runtime = new CollectorRuntime({
            configuration: {
                ...this.config.shared,
                instrumentSymbol: instrument.instrumentSymbol,
                venue: instrument.venue,
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
            // Bound to the contract, so every line a runtime writes says which
            // one wrote it. Four collectors share one log.
            log: this.config.log.child({
                venue: instrument.venue,
                instrumentSymbol: instrument.instrumentSymbol,
            }),
        });

        try {
            await runtime.start();
            if (this.hasShutdownBegun()) {
                // Stopped while this one was still coming up. Nothing drains the
                // running collectors again, so it lets go here or it holds its
                // socket and its write buffer for good.
                await runtime.stop();
                return;
            }
            this.running.set(nameContract(instrument), {
                runtime,
                contract: instrument,
                startedAtMs: this.config.readNowMs(),
            });
        } catch (error) {
            // One venue refusing must not stop the others: the next reconcile
            // tries again, and every other contract keeps writing.
            this.config.log.warning('Could not start a collector', {
                venue: instrument.venue,
                instrumentSymbol: instrument.instrumentSymbol,
                reason: describeError(error),
            });
            await runtime.stop();
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
