import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderBookService } from '../../../src/workers/core/order-book-service.ts';
import { buildDiff, buildSnapshot, createSnapshotSource } from '../../mocks/depth-fixtures.ts';

interface Harness {
    readonly service: OrderBookService;
    readonly source: ReturnType<typeof createSnapshotSource>;
    readonly desynchronizations: string[];
}

function buildHarness(lastUpdateId = 100, deepRepairIntervalMs = 3_600_000): Harness {
    const source = createSnapshotSource(lastUpdateId);
    const desynchronizations: string[] = [];

    const service = new OrderBookService({
        fetchDepthSnapshot: source.fetchDepthSnapshot,
        retainedPriceRangeRatio: 0.1,
        deepRepairIntervalMs,
        snapshotRetryDelayMs: 1,
        onDesynchronized: (reason) => desynchronizations.push(reason),
        onSynchronized: () => undefined,
    });

    return { service, source, desynchronizations };
}

describe('OrderBookService', () => {
    it('reports no book before the first ladder arrives', () => {
        const { service } = buildHarness();

        service.start();

        expect(service.readBook()).toBeNull();
    });

    it('activates once a buffered update overlaps the ladder', async () => {
        const { service } = buildHarness(100);
        service.start();

        service.ingestDiff(buildDiff({ firstUpdateId: 95, finalUpdateId: 105 }));
        await vi.waitFor(() => expect(service.isSynchronized).toBe(true));

        expect(service.readBook()).toEqual({
            bestBidPrice: 100,
            bestAskPrice: 101,
            bidQuantityByPrice: new Map([[100, 5], [99, 4]]),
            askQuantityByPrice: new Map([[101, 6]]),
        });
    });

    it('discards updates the ladder already contains', async () => {
        const { service } = buildHarness(100);
        service.start();

        service.ingestDiff(buildDiff({ firstUpdateId: 10, finalUpdateId: 20, bidLevels: [['100', '999']] }));
        service.ingestDiff(buildDiff({ firstUpdateId: 95, finalUpdateId: 105 }));
        await vi.waitFor(() => expect(service.isSynchronized).toBe(true));

        expect(service.readBook()?.bidQuantityByPrice.get(100)).toBe(5);
    });

    it('applies an update that arrives after synchronising', async () => {
        const { service } = buildHarness(100);
        service.start();
        service.ingestDiff(buildDiff({ firstUpdateId: 95, finalUpdateId: 105 }));
        await vi.waitFor(() => expect(service.isSynchronized).toBe(true));

        service.ingestDiff(buildDiff({
            firstUpdateId: 106,
            finalUpdateId: 110,
            previousFinalUpdateId: 105,
            bidLevels: [['100', '42']],
        }));

        expect(service.readBook()?.bidQuantityByPrice.get(100)).toBe(42);
    });

    it('abandons the book when an update names a predecessor it never applied', async () => {
        const { service, desynchronizations } = buildHarness(100);
        service.start();
        service.ingestDiff(buildDiff({ firstUpdateId: 95, finalUpdateId: 105 }));
        await vi.waitFor(() => expect(service.isSynchronized).toBe(true));

        service.ingestDiff(buildDiff({ firstUpdateId: 200, finalUpdateId: 210, previousFinalUpdateId: 199 }));

        expect([service.isSynchronized, desynchronizations.length]).toEqual([false, 1]);
    });

    it('refuses a ladder that predates the buffered updates', async () => {
        const { service, source } = buildHarness(10);
        service.start();

        service.ingestDiff(buildDiff({ firstUpdateId: 500, finalUpdateId: 510 }));
        await vi.waitFor(() => expect(source.fetchDepthSnapshot.mock.calls.length).toBeGreaterThan(1));
        service.stop();

        expect(service.isSynchronized).toBe(false);
    });

    it('retries until the ladder endpoint answers', async () => {
        const { service, source } = buildHarness(100);
        source.fetchDepthSnapshot
            .mockRejectedValueOnce(new Error('venue unavailable'))
            .mockResolvedValue(buildSnapshot(100));
        service.start();

        service.ingestDiff(buildDiff({ firstUpdateId: 95, finalUpdateId: 105 }));
        await vi.waitFor(() => expect(service.isSynchronized).toBe(true));

        expect(source.fetchDepthSnapshot.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('reports a desynchronisation only once per break', async () => {
        const { service, desynchronizations } = buildHarness(100);
        service.start();
        service.ingestDiff(buildDiff({ firstUpdateId: 95, finalUpdateId: 105 }));
        await vi.waitFor(() => expect(service.isSynchronized).toBe(true));

        service.invalidate('connection lost');
        service.invalidate('connection lost again');

        expect(desynchronizations).toEqual(['connection lost']);
    });

    it('ignores updates once stopped', async () => {
        const { service } = buildHarness(100);
        service.start();
        service.ingestDiff(buildDiff({ firstUpdateId: 95, finalUpdateId: 105 }));
        await vi.waitFor(() => expect(service.isSynchronized).toBe(true));

        service.stop();
        service.ingestDiff(buildDiff({ firstUpdateId: 106, finalUpdateId: 110, previousFinalUpdateId: 105 }));

        expect(service.readBook()).toBeNull();
    });

    it('refuses to start twice', () => {
        const { service } = buildHarness();
        service.start();

        expect(() => service.start()).toThrow();
    });
});

describe('OrderBookService repairing the deep book', () => {
    const REPAIR_INTERVAL_MS = 60_000;
    /** What the first ladder plus the activating update leave applied. */
    const ACTIVATED_UPDATE_ID = 105;

    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    /**
     * A synchronised mirror whose repair cycle has not come round yet.
     *
     * Driven through the interval the collector actually arms rather than a door
     * opened for the test: the cycle is what is being pinned, and a cycle nobody
     * schedules is not one.
     */
    async function buildRepairing(): Promise<Harness> {
        const harness = buildHarness(100, REPAIR_INTERVAL_MS);
        harness.service.start();
        await vi.advanceTimersByTimeAsync(0);
        harness.service.ingestDiff(buildDiff({ firstUpdateId: 95, finalUpdateId: ACTIVATED_UPDATE_ID }));
        return harness;
    }

    /**
     * A ladder fetch that only answers once the returned release is called.
     *
     * Every pending fetch is held, not just the newest: a rebuild started
     * mid-repair asks for a ladder of its own, and a gate that forgot the
     * earlier one would leave the repair suspended for ever.
     */
    function gateLadder(harness: Harness, lastUpdateId: number): () => void {
        const waiting: Array<() => void> = [];
        harness.source.fetchDepthSnapshot.mockImplementation(async () => {
            await new Promise<void>((resolve) => { waiting.push(resolve); });
            return buildSnapshot(lastUpdateId);
        });
        return () => { waiting.splice(0).forEach((resolve) => { resolve(); }); };
    }

    it('takes the fresh ladder over the span the ladder covers', async () => {
        // The mirror drifts: a level the venue dropped without ever saying so
        // rests there for ever unless a fresh ladder overwrites the span.
        const harness = await buildRepairing();
        harness.service.ingestDiff(buildDiff({
            previousFinalUpdateId: ACTIVATED_UPDATE_ID,
            firstUpdateId: 106,
            finalUpdateId: 110,
            bidLevels: [['100', '999']],
        }));
        harness.source.fetchDepthSnapshot.mockResolvedValue(buildSnapshot(200));

        await vi.advanceTimersByTimeAsync(REPAIR_INTERVAL_MS);

        expect(harness.service.readBook()?.bidQuantityByPrice.get(100)).toBe(5);
    });

    it('keeps an update that arrived while the ladder was in flight', async () => {
        // The whole reason the repair buffers: a fetch takes long enough for the
        // venue to move, and overwriting the span would throw that away.
        const harness = await buildRepairing();
        const releaseLadder = gateLadder(harness, 200);

        await vi.advanceTimersByTimeAsync(REPAIR_INTERVAL_MS);
        harness.service.ingestDiff(buildDiff({
            previousFinalUpdateId: ACTIVATED_UPDATE_ID,
            firstUpdateId: 201,
            finalUpdateId: 210,
            bidLevels: [['100', '77']],
        }));
        releaseLadder();
        await vi.advanceTimersByTimeAsync(0);

        expect(harness.service.readBook()?.bidQuantityByPrice.get(100)).toBe(77);
    });

    it('ignores a buffered update the ladder already accounts for', async () => {
        const harness = await buildRepairing();
        const releaseLadder = gateLadder(harness, 300);

        await vi.advanceTimersByTimeAsync(REPAIR_INTERVAL_MS);
        harness.service.ingestDiff(buildDiff({
            previousFinalUpdateId: ACTIVATED_UPDATE_ID,
            firstUpdateId: 106,
            finalUpdateId: 250,
            bidLevels: [['100', '77']],
        }));
        releaseLadder();
        await vi.advanceTimersByTimeAsync(0);

        expect(harness.service.readBook()?.bidQuantityByPrice.get(100)).toBe(5);
    });

    it('drops a level further from the touch than the band it keeps', async () => {
        const harness = await buildRepairing();
        harness.service.ingestDiff(buildDiff({
            previousFinalUpdateId: ACTIVATED_UPDATE_ID,
            firstUpdateId: 106,
            finalUpdateId: 110,
            bidLevels: [['1', '3']],
        }));

        await vi.advanceTimersByTimeAsync(REPAIR_INTERVAL_MS);

        expect(harness.service.readBook()?.bidQuantityByPrice.has(1)).toBe(false);
    });

    it('leaves the mirror usable when the ladder cannot be fetched', async () => {
        // Repair is opportunistic. A venue that will not answer is no reason to
        // throw away a book that is still true.
        const harness = await buildRepairing();
        harness.source.fetchDepthSnapshot.mockRejectedValue(new Error('venue unreachable'));

        await vi.advanceTimersByTimeAsync(REPAIR_INTERVAL_MS);

        expect(harness.service.isSynchronized).toBe(true);
        expect(harness.service.readBook()?.bidQuantityByPrice.get(100)).toBe(5);
    });

    it('writes nothing into a book that stopped being trusted mid-repair', async () => {
        const harness = await buildRepairing();
        harness.service.ingestDiff(buildDiff({
            previousFinalUpdateId: ACTIVATED_UPDATE_ID,
            firstUpdateId: 106,
            finalUpdateId: 110,
            bidLevels: [['1', '3']],
        }));
        const levelCountBeforeRepair = harness.service.levelCount;
        const releaseLadder = gateLadder(harness, 200);

        await vi.advanceTimersByTimeAsync(REPAIR_INTERVAL_MS);
        harness.service.invalidate('stream dropped');
        releaseLadder();
        await vi.advanceTimersByTimeAsync(0);

        expect(harness.service.levelCount).toBe(levelCountBeforeRepair);
    });

    it('asks for one ladder at a time however long the fetch takes', async () => {
        // A venue slower than the cycle would otherwise stack repairs, each
        // buffering and replaying over the others' work.
        const harness = await buildRepairing();
        gateLadder(harness, 200);

        await vi.advanceTimersByTimeAsync(REPAIR_INTERVAL_MS);
        const laddersAskedByFirstRepair = harness.source.fetchDepthSnapshot.mock.calls.length;
        await vi.advanceTimersByTimeAsync(REPAIR_INTERVAL_MS * 3);

        expect(harness.source.fetchDepthSnapshot.mock.calls.length).toBe(laddersAskedByFirstRepair);
    });

    it('asks for no ladder of its own while the mirror is being rebuilt', async () => {
        // The rebuild is already fetching one. A second request buys nothing and
        // spends the venue's rate limit twice over.
        const harness = buildHarness(100, REPAIR_INTERVAL_MS);
        harness.service.start();
        await vi.advanceTimersByTimeAsync(0);
        const laddersAskedByRebuild = harness.source.fetchDepthSnapshot.mock.calls.length;

        await vi.advanceTimersByTimeAsync(REPAIR_INTERVAL_MS);

        expect(harness.source.fetchDepthSnapshot.mock.calls.length).toBe(laddersAskedByRebuild);
    });

    it('stops asking for ladders once the mirror is stopped', async () => {
        const harness = await buildRepairing();
        await vi.advanceTimersByTimeAsync(REPAIR_INTERVAL_MS);
        const laddersAsked = harness.source.fetchDepthSnapshot.mock.calls.length;

        harness.service.stop();
        await vi.advanceTimersByTimeAsync(REPAIR_INTERVAL_MS * 3);

        expect(harness.source.fetchDepthSnapshot.mock.calls.length).toBe(laddersAsked);
    });

    it('releases the repair cycle when the mirror is stopped', async () => {
        // A collector restarts its mirrors over a long session, and a cycle left
        // armed on a dead one holds the host open and fires for ever.
        const harness = await buildRepairing();

        harness.service.stop();

        expect(vi.getTimerCount()).toBe(0);
    });
});
