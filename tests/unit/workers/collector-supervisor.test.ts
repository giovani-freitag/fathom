import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CollectorSupervisor } from '../../../src/workers/collector-supervisor.ts';
import { createMockCollectorLog, type MockCollectorLog } from '../../mocks/collector-log.ts';
import type { LiquidityArchive } from '../../../src/database/services/liquidity-archive.ts';
import { openSilentMarketDataSocket } from '../../mocks/market-data-socket.ts';
import type { RecordedContract } from '../../../src/shared/core/recording-control.ts';
import { FIRST_VENUE } from '../../../src/shared/core/recording-control.ts';

const STALL_TIMEOUT_MS = 120_000;

function buildArchive(): LiquidityArchive {
    return {
        open: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        registerInstrument: vi.fn().mockResolvedValue(undefined),
        appendTradeClusters: vi.fn().mockResolvedValue(undefined),
        recordGap: vi.fn().mockResolvedValue(undefined),
        findLastFrameTimestamp: vi.fn().mockResolvedValue(null),
    };
}

function buildContract(instrumentSymbol: string, venue = FIRST_VENUE): RecordedContract {
    return { venue, instrumentSymbol, priceBucketSize: 10, frameIntervalMs: 1_000, isEnabled: true };
}

/**
 * What the supervisor names a contract, which is the venue and the symbol.
 *
 * Asserted through this rather than as a bare symbol, so a test cannot pass
 * while the supervisor holds two venues' contracts under one key.
 */
function named(instrumentSymbol: string, venue = FIRST_VENUE): string {
    return `${venue}/${instrumentSymbol}`;
}

interface Harness {
    readonly supervisor: CollectorSupervisor;
    readonly log: MockCollectorLog;
    readonly listContracts: ReturnType<typeof vi.fn>;
    readonly archive: LiquidityArchive;
    readonly pruneToBudget: ReturnType<typeof vi.fn>;
    setNowMs: (nowMs: number) => void;
    setContracts: (contracts: readonly RecordedContract[]) => void;
}

function buildHarness(contracts: readonly RecordedContract[], given?: LiquidityArchive): Harness {
    const log = createMockCollectorLog();
    const listContracts = vi.fn().mockResolvedValue(contracts);
    const archive = given ?? buildArchive();
    const pruneToBudget = vi.fn().mockResolvedValue(0);
    let nowMs = 1_000_000;

    const supervisor = new CollectorSupervisor({
        control: {
            listContracts,
            saveContract: vi.fn().mockResolvedValue(undefined),
            removeContract: vi.fn().mockResolvedValue(undefined),
            readBudget: vi.fn().mockResolvedValue({ maximumBytes: 1, usedBytes: 0, availableBytes: null }),
            setBudget: vi.fn().mockResolvedValue(undefined),
            pruneToBudget,
        },
        archive,
        openSocket: openSilentMarketDataSocket,
        log: log.log,
        shared: {
            recordedPriceRangeRatio: 0.02,
            retainedPriceRangeRatio: 0.1,
            deepRepairIntervalMs: 3_600_000,
        },
        framesPerFlush: 1,
        reconcileIntervalMs: 15_000,
        stallTimeoutMs: STALL_TIMEOUT_MS,
        readNowMs: () => nowMs,
    });

    return {
        supervisor,
        log,
        listContracts,
        archive,
        pruneToBudget,
        setNowMs: (next) => { nowMs = next; },
        setContracts: (next) => { listContracts.mockResolvedValue(next); },
    };
}

describe('CollectorSupervisor liveness', () => {
    let harness: Harness;

    beforeEach(async () => {
        harness = buildHarness([buildContract('BTCUSDT'), buildContract('ETHUSDT')]);
        await harness.supervisor.start();
    });

    it('brings up every enabled contract, and only those', async () => {
        // A disabled one in the list, because there was none: every contract
        // the fixture built was enabled, so the filter that leaves the disabled
        // ones alone could be deleted and this still passed.
        harness.setContracts([
            buildContract('BTCUSDT'),
            buildContract('ETHUSDT'),
            { ...buildContract('SOLUSDT'), isEnabled: false },
        ]);
        await harness.supervisor.reconcileNow();

        expect([...harness.supervisor.recording].sort())
            .toEqual([named('BTCUSDT'), named('ETHUSDT')]);
    });

    it('records the same symbol on two venues as two contracts', () => {
        // Keyed by the symbol alone, the second to be enabled was taken for the
        // first — already running, so never started — and the chart was shown a
        // recording of the wrong market under the right name.
        harness.setContracts([buildContract('BTCUSDT'), buildContract('BTCUSDT', 'bybit')]);

        return harness.supervisor.reconcileNow().then(() => {
            expect([...harness.supervisor.recording].sort())
                .toEqual([named('BTCUSDT'), named('BTCUSDT', 'bybit')]);
        });
    });

    it('keeps a collector that has not yet had time to record', async () => {
        // Asserted as "nothing was torn down", because the count is the same
        // either way: the same pass that drops a stalled collector starts a
        // replacement, so two are running whether one was replaced or not.
        harness.setNowMs(1_000_000 + STALL_TIMEOUT_MS - 1);

        await harness.supervisor.reconcileNow();

        expect(harness.log.lines.filter((line) => line.level === 'warning')).toEqual([]);
        expect(harness.supervisor.recording).toHaveLength(2);
    });

    it('replaces a collector that stopped recording', async () => {
        // The silent socket never feeds the book, so no frame is ever captured:
        // past the timeout both runtimes read as stalled, which is the state
        // that used to survive until the process itself was restarted.
        harness.setNowMs(1_000_000 + STALL_TIMEOUT_MS + 1);

        await harness.supervisor.reconcileNow();

        expect(harness.log.lines.map((line) => line.message))
            .toContain('Collector stopped recording and is being replaced');
    });

    it('starts a replacement in the same pass that dropped the stalled one', async () => {
        harness.setNowMs(1_000_000 + STALL_TIMEOUT_MS + 1);

        await harness.supervisor.reconcileNow();

        expect([...harness.supervisor.recording].sort()).toEqual([named('BTCUSDT'), named('ETHUSDT')]);
    });

    it('says which contract stalled', async () => {
        harness.setNowMs(1_000_000 + STALL_TIMEOUT_MS + 1);

        await harness.supervisor.reconcileNow();

        expect(harness.log.linesAbout('ETHUSDT').map((line) => line.message))
            .toContain('Collector stopped recording and is being replaced');
    });
});

describe('CollectorSupervisor logging', () => {
    it('stamps the contract on every line its runtime writes', async () => {
        const harness = buildHarness([buildContract('BTCUSDT'), buildContract('ETHUSDT')]);

        await harness.supervisor.start();

        expect(harness.log.linesAbout('ETHUSDT').map((line) => line.message)).toContain('Recording');
        expect(harness.log.linesAbout('BTCUSDT').map((line) => line.message)).toContain('Recording');
    });

    it('names the contract it could not start', async () => {
        const harness = buildHarness([buildContract('BTCUSDT')]);
        harness.listContracts.mockRejectedValueOnce(new Error('the database went away'));

        await harness.supervisor.start();

        expect(harness.log.lines.map((line) => line.message))
            .toContain('Could not reconcile the recording');
    });
});

describe('CollectorSupervisor shutdown', () => {
    it('stops every collector it was running', async () => {
        const harness = buildHarness([buildContract('BTCUSDT'), buildContract('ETHUSDT')]);
        await harness.supervisor.start();

        await harness.supervisor.stop();

        expect(harness.supervisor.recording).toEqual([]);
    });

    it('releases the archive the collectors shared', async () => {
        const harness = buildHarness([buildContract('BTCUSDT')]);
        await harness.supervisor.start();

        await harness.supervisor.stop();

        expect(harness.archive.close).toHaveBeenCalled();
    });

    it('brings nothing back up after it was stopped', async () => {
        const harness = buildHarness([buildContract('BTCUSDT')]);
        await harness.supervisor.start();
        await harness.supervisor.stop();

        await harness.supervisor.reconcileNow();

        expect(harness.supervisor.recording).toEqual([]);
    });

    it('asks nothing of the database once it has been stopped', async () => {
        // The archive it read through is closed, and a pass against a closed
        // archive spends the shutdown logging failures nobody can act on.
        const harness = buildHarness([buildContract('BTCUSDT')]);
        await harness.supervisor.start();
        await harness.supervisor.stop();
        const contractsListed = harness.listContracts.mock.calls.length;

        await harness.supervisor.reconcileNow();

        expect(harness.listContracts.mock.calls.length).toBe(contractsListed);
    });

    it('brings nothing up when it is stopped before the first pass begins', async () => {
        const harness = buildHarness([buildContract('BTCUSDT')]);
        const starting = harness.supervisor.start();

        await harness.supervisor.stop();
        await starting;

        expect(harness.supervisor.recording).toEqual([]);
    });

    it('leaves nothing running that a pass in flight was still starting', async () => {
        // A collector started after the drain holds its socket and its write
        // buffer for the life of the process, and nothing ever stops it.
        const harness = buildHarness([buildContract('BTCUSDT')]);
        const reachedVenue = Promise.withResolvers<void>();
        const releaseVenue = Promise.withResolvers<void>();
        vi.mocked(harness.archive.registerInstrument).mockImplementationOnce(async () => {
            reachedVenue.resolve();
            await releaseVenue.promise;
        });
        const starting = harness.supervisor.start();
        await reachedVenue.promise;

        await harness.supervisor.stop();
        releaseVenue.resolve();
        await starting;

        expect(harness.supervisor.recording).toEqual([]);
    });
});

describe('CollectorSupervisor reconciling', () => {
    it('stops a collector whose contract was switched off', async () => {
        const harness = buildHarness([buildContract('BTCUSDT'), buildContract('ETHUSDT')]);
        await harness.supervisor.start();

        harness.setContracts([buildContract('BTCUSDT'), { ...buildContract('ETHUSDT'), isEnabled: false }]);
        await harness.supervisor.reconcileNow();

        expect(harness.supervisor.recording).toEqual([named('BTCUSDT')]);
    });

    it('says which contract it stopped recording', async () => {
        const harness = buildHarness([buildContract('ETHUSDT')]);
        await harness.supervisor.start();

        harness.setContracts([{ ...buildContract('ETHUSDT'), isEnabled: false }]);
        await harness.supervisor.reconcileNow();

        expect(harness.log.lines).toContainEqual({
            level: 'info',
            message: 'Stopped recording',
            fields: { venue: FIRST_VENUE, instrumentSymbol: 'ETHUSDT' },
        });
    });

    it('says how much history the disk budget cost', async () => {
        const harness = buildHarness([buildContract('BTCUSDT')]);
        harness.pruneToBudget.mockResolvedValue(3);

        await harness.supervisor.start();

        expect(harness.log.lines).toContainEqual({
            level: 'warning',
            message: 'Dropped the oldest partitions to stay inside the disk budget',
            fields: { partitions: 3 },
        });
    });

    it('says nothing about the budget when it dropped no history', async () => {
        const harness = buildHarness([buildContract('BTCUSDT')]);

        await harness.supervisor.start();

        expect(harness.log.lines.map((line) => line.message)).not.toContain(
            'Dropped the oldest partitions to stay inside the disk budget',
        );
    });

    it('keeps recording when a contract cannot be listed', async () => {
        // The next pass tries again: a database blip must not take the whole
        // recording down with it.
        const harness = buildHarness([buildContract('BTCUSDT')]);
        await harness.supervisor.start();

        harness.listContracts.mockRejectedValueOnce(new Error('database unreachable'));
        await harness.supervisor.reconcileNow();

        expect(harness.supervisor.recording).toEqual([named('BTCUSDT')]);
    });
});

describe('bringing several contracts up', () => {
    it('opens them together rather than one handshake after another', async () => {
        // Every second a contract spends waiting behind another one's handshake
        // is a second of book that nothing wrote down, and it cannot be
        // recorded again.
        let inFlight = 0;
        let mostAtOnce = 0;
        const archive = buildArchive();
        archive.registerInstrument = vi.fn(async () => {
            inFlight += 1;
            mostAtOnce = Math.max(mostAtOnce, inFlight);
            await new Promise((wake) => { setTimeout(wake, 20); });
            inFlight -= 1;
        });

        const harness = buildHarness(
            ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT'].map((symbol) => buildContract(symbol)),
            archive,
        );
        await harness.supervisor.start();

        expect(harness.supervisor.recording).toHaveLength(4);
        expect(mostAtOnce).toBeGreaterThan(1);
        await harness.supervisor.stop();
    });
});

describe('a contract that was changed rather than switched off', () => {
    it('is recorded again on the grid it was changed to', async () => {
        // The archive says which grid each block holds, so what is stored stays
        // readable. What a supervisor that only asked "is it running" would do
        // is write every new column on a grid nobody asked for any more.
        const harness = buildHarness([buildContract('BTCUSDT')]);
        await harness.supervisor.start();
        const registered = vi.mocked(harness.archive.registerInstrument);
        registered.mockClear();

        // The rate, not the grid: the grid is caught by the first term of the
        // comparison, so varying it alone left the second term untested.
        harness.setContracts([{ ...buildContract('BTCUSDT'), frameIntervalMs: 5_000 }]);
        await harness.supervisor.reconcileNow();

        expect(harness.supervisor.recording).toEqual([named('BTCUSDT')]);
        expect(registered).toHaveBeenCalledWith(expect.objectContaining({ frameIntervalMs: 5_000 }));
        await harness.supervisor.stop();
    });

    it('is left alone where nothing about it changed', async () => {
        // A pass runs every fifteen seconds. Restarting on every one of them
        // would be a socket reopened and a snapshot refetched four times a
        // minute, and a gap in the ledger for each.
        const harness = buildHarness([buildContract('BTCUSDT')]);
        await harness.supervisor.start();
        const registered = vi.mocked(harness.archive.registerInstrument);
        registered.mockClear();

        await harness.supervisor.reconcileNow();

        expect(registered).not.toHaveBeenCalled();
        await harness.supervisor.stop();
    });
});
