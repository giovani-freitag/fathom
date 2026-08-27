import { releaseTimerFromEventLoop, type TimerHandle } from './collector-timers.ts';
import { delay } from './delay.ts';
import type { DepthDiff, DepthSnapshot, OrderBookReading } from './depth-types.ts';
import { OrderBookState } from './order-book-state.ts';

type SynchronizationState = 'stopped' | 'desynchronized' | 'awaitingSnapshot' | 'synchronized';

/**
 * Why an activation attempt did not produce a usable book.
 */
type ActivationOutcome = 'activated' | 'awaitingUpdates' | 'ladderUnusable';

export interface OrderBookServiceConfig {
    readonly fetchDepthSnapshot: () => Promise<DepthSnapshot>;
    readonly retainedPriceRangeRatio: number;
    readonly deepRepairIntervalMs: number;
    readonly snapshotRetryDelayMs: number;
    readonly onDesynchronized: (reason: string) => void;
    readonly onSynchronized: () => void;
}

/**
 * Keeps a local mirror of the venue's book, and knows when it stopped being one.
 */
export class OrderBookService {
    private readonly config: OrderBookServiceConfig;
    private readonly state = new OrderBookState();
    private readonly bufferedDiffs: DepthDiff[] = [];

    private synchronizationState: SynchronizationState = 'stopped';
    private pendingSnapshot: DepthSnapshot | null = null;
    private lastAppliedFinalUpdateId = 0;
    private repairBuffer: DepthDiff[] | null = null;
    private deepRepairTimer: TimerHandle | null = null;

    constructor(config: OrderBookServiceConfig) {
        this.config = config;
        this.handleDeepRepairDue = this.handleDeepRepairDue.bind(this);
    }

    /**
     * Begins mirroring: requests the first ladder and arms the repair cycle.
     */
    start(): void {
        if (this.synchronizationState !== 'stopped') {
            throw new Error('This order book service is already running');
        }
        this.enterState('desynchronized');
        this.deepRepairTimer = setInterval(this.handleDeepRepairDue, this.config.deepRepairIntervalMs);
        releaseTimerFromEventLoop(this.deepRepairTimer);
        void this.synchronize();
    }

    /**
     * Stops mirroring and releases the repair cycle.
     */
    stop(): void {
        this.enterState('stopped');
        this.pendingSnapshot = null;
        this.repairBuffer = null;
        this.bufferedDiffs.length = 0;
        if (this.deepRepairTimer !== null) {
            clearInterval(this.deepRepairTimer);
            this.deepRepairTimer = null;
        }
    }

    /**
     * Feeds one incremental update into the mirror.
     *
     * @param diff - The update, in venue-neutral form.
     */
    ingestDiff(diff: DepthDiff): void {
        if (this.synchronizationState === 'stopped') {
            return;
        }
        this.repairBuffer?.push(diff);

        if (this.synchronizationState === 'synchronized') {
            this.applyWhileSynchronized(diff);
            return;
        }

        this.bufferedDiffs.push(diff);
        if (this.synchronizationState === 'desynchronized') {
            void this.synchronize();
            return;
        }
        if (this.pendingSnapshot === null) {
            return;
        }
        if (this.tryActivate(this.pendingSnapshot) === 'ladderUnusable') {
            this.pendingSnapshot = null;
            this.enterState('desynchronized');
            void this.synchronize();
        }
    }

    /**
     * Declares the mirror untrustworthy and schedules a rebuild.
     *
     * @param reason - What broke, for the gap record.
     */
    invalidate(reason: string): void {
        if (this.synchronizationState === 'stopped') {
            return;
        }
        const wasUsable = this.synchronizationState === 'synchronized';
        this.enterState('desynchronized');
        this.pendingSnapshot = null;
        this.lastAppliedFinalUpdateId = 0;
        this.bufferedDiffs.length = 0;

        if (wasUsable) {
            this.config.onDesynchronized(reason);
        }
        void this.synchronize();
    }

    /**
     * A consistent read of the mirror.
     *
     * @returns The touch and both sides, or null while the mirror is rebuilding.
     */
    readBook(): OrderBookReading | null {
        if (this.synchronizationState !== 'synchronized') {
            return null;
        }
        const topOfBook = this.state.resolveTopOfBook();
        if (topOfBook === null) {
            return null;
        }
        return {
            bestBidPrice: topOfBook.bestBidPrice,
            bestAskPrice: topOfBook.bestAskPrice,
            bidQuantityByPrice: this.state.bidLevels,
            askQuantityByPrice: this.state.askLevels,
        };
    }

    get isSynchronized(): boolean {
        return this.synchronizationState === 'synchronized';
    }

    get levelCount(): number {
        return this.state.levelCount;
    }

    private get isAwaitingSnapshot(): boolean {
        return this.synchronizationState === 'awaitingSnapshot';
    }

    /**
     * The single place the synchronisation state moves.
     */
    private enterState(nextState: SynchronizationState): void {
        this.synchronizationState = nextState;
    }

    private applyWhileSynchronized(diff: DepthDiff): void {
        if (diff.previousFinalUpdateId !== this.lastAppliedFinalUpdateId) {
            this.invalidate(
                `update sequence broke: expected ${this.lastAppliedFinalUpdateId}, `
                + `update claims ${diff.previousFinalUpdateId}`,
            );
            return;
        }
        this.state.applyDelta(diff.bidLevels, diff.askLevels);
        this.lastAppliedFinalUpdateId = diff.finalUpdateId;
    }

    private async synchronize(): Promise<void> {
        if (this.synchronizationState !== 'desynchronized') {
            return;
        }
        this.enterState('awaitingSnapshot');
        this.pendingSnapshot = null;

        while (this.isAwaitingSnapshot) {
            if (await this.attemptSynchronization()) {
                return;
            }
            await delay(this.config.snapshotRetryDelayMs);
        }
    }

    /**
     * One pass at rebuilding the book from a fresh ladder.
     *
     * @returns True when nothing further should be attempted, false to retry
     * after the configured wait.
     */
    private async attemptSynchronization(): Promise<boolean> {
        try {
            return await this.buildFromFreshLadder();
        } catch {
            // Another ladder is the mirror's only way back, so nothing may leave
            // this loop: an escaping failure would desynchronise the collector
            // for the rest of the session, buffering updates nobody applies.
            return false;
        }
    }

    /**
     * Rebuilds the book from a ladder the venue serves now.
     *
     * @returns True when nothing further should be attempted.
     */
    private async buildFromFreshLadder(): Promise<boolean> {
        const snapshot = await this.config.fetchDepthSnapshot();
        if (!this.isAwaitingSnapshot) {
            return true;
        }

        const outcome = this.tryActivate(snapshot);
        if (outcome === 'awaitingUpdates') {
            // The next update decides; ingesting one retries activation.
            this.pendingSnapshot = snapshot;
        }
        return outcome !== 'ladderUnusable';
    }

    private tryActivate(snapshot: DepthSnapshot): ActivationOutcome {
        // A source that answers with something other than a ladder must not be
        // able to throw out of here: activation is attempted both from the
        // rebuild loop and from the socket's own message handler.
        if (!Array.isArray(snapshot.bidLevels) || !Array.isArray(snapshot.askLevels)) {
            return 'ladderUnusable';
        }

        // Anything the ladder already contains is redundant.
        while (this.bufferedDiffs.length > 0 && this.bufferedDiffs[0]!.finalUpdateId < snapshot.lastUpdateId) {
            this.bufferedDiffs.shift();
        }

        const firstApplicableDiff = this.bufferedDiffs[0];
        if (firstApplicableDiff === undefined) {
            return 'awaitingUpdates';
        }

        // The ladder predates the buffer, so the updates between them are lost
        // and no book can be built from this pair.
        if (firstApplicableDiff.firstUpdateId > snapshot.lastUpdateId) {
            return 'ladderUnusable';
        }

        this.state.replaceWith(snapshot.bidLevels, snapshot.askLevels);
        for (const bufferedDiff of this.bufferedDiffs) {
            this.state.applyDelta(bufferedDiff.bidLevels, bufferedDiff.askLevels);
            this.lastAppliedFinalUpdateId = bufferedDiff.finalUpdateId;
        }

        this.bufferedDiffs.length = 0;
        this.pendingSnapshot = null;
        this.enterState('synchronized');
        this.config.onSynchronized();
        return 'activated';
    }

    private handleDeepRepairDue(): void {
        void this.repairDeepBook();
    }

    private async repairDeepBook(): Promise<void> {
        if (!this.isSynchronized || this.repairBuffer !== null) {
            return;
        }

        this.repairBuffer = [];
        try {
            const ladder = await this.config.fetchDepthSnapshot();
            if (this.synchronizationState !== 'synchronized') {
                return;
            }
            this.state.mergeWithinLadderSpan(ladder.bidLevels, ladder.askLevels);
            this.replayOverMergedSpan(ladder.lastUpdateId);
            this.pruneDistantLevels();
        } catch {
            // Repair is opportunistic: the mirror is still valid without it, and
            // the next cycle tries again.
        } finally {
            this.repairBuffer = null;
        }
    }

    private replayOverMergedSpan(ladderLastUpdateId: number): void {
        for (const diff of this.repairBuffer ?? []) {
            if (diff.finalUpdateId > ladderLastUpdateId) {
                this.state.applyDelta(diff.bidLevels, diff.askLevels);
            }
        }
    }

    private pruneDistantLevels(): void {
        const topOfBook = this.state.resolveTopOfBook();
        if (topOfBook === null) {
            return;
        }
        const midPrice = (topOfBook.bestBidPrice + topOfBook.bestAskPrice) / 2;
        this.state.pruneBeyond(midPrice, midPrice * this.config.retainedPriceRangeRatio);
    }
}
