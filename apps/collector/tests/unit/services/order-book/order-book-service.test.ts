import { describe, expect, it, vi } from 'vitest';
import { OrderBookService } from '../../../../src/services/order-book/order-book-service.ts';
import { buildDiff, buildSnapshot, createSnapshotSource } from '../../../mocks/depth-fixtures.ts';

interface Harness {
    readonly service: OrderBookService;
    readonly source: ReturnType<typeof createSnapshotSource>;
    readonly desynchronizations: string[];
}

function buildHarness(lastUpdateId = 100): Harness {
    const source = createSnapshotSource(lastUpdateId);
    const desynchronizations: string[] = [];

    const service = new OrderBookService({
        fetchDepthSnapshot: source.fetchDepthSnapshot,
        retainedPriceRangeRatio: 0.1,
        deepRepairIntervalMs: 3_600_000,
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
