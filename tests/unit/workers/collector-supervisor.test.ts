import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CollectorSupervisor } from '../../../src/workers/collector-supervisor.ts';
import { createMockCollectorLog, type MockCollectorLog } from '../../mocks/collector-log.ts';
import type { LiquidityArchive } from '../../../src/database/services/liquidity-archive.ts';
import { openSilentMarketDataSocket } from '../../mocks/market-data-socket.ts';
import type { RecordedContract } from '../../../src/shared/core/recording-control.ts';

const STALL_TIMEOUT_MS = 120_000;

function buildArchive(): LiquidityArchive {
    return {
        open: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        registerInstrument: vi.fn().mockResolvedValue(undefined),
        appendFrames: vi.fn().mockResolvedValue(undefined),
        appendTradeClusters: vi.fn().mockResolvedValue(undefined),
        recordGap: vi.fn().mockResolvedValue(undefined),
        findLastFrameTimestamp: vi.fn().mockResolvedValue(null),
    };
}

function buildContract(instrumentSymbol: string): RecordedContract {
    return { instrumentSymbol, priceBucketSize: 10, frameIntervalMs: 1_000, isEnabled: true };
}

interface Harness {
    readonly supervisor: CollectorSupervisor;
    readonly log: MockCollectorLog;
    readonly listContracts: ReturnType<typeof vi.fn>;
    setNowMs: (nowMs: number) => void;
}

function buildHarness(contracts: readonly RecordedContract[]): Harness {
    const log = createMockCollectorLog();
    const listContracts = vi.fn().mockResolvedValue(contracts);
    let nowMs = 1_000_000;

    const supervisor = new CollectorSupervisor({
        control: {
            listContracts,
            saveContract: vi.fn().mockResolvedValue(undefined),
            readBudget: vi.fn().mockResolvedValue({ maximumBytes: 1, usedBytes: 0, availableBytes: null }),
            setBudget: vi.fn().mockResolvedValue(undefined),
            pruneToBudget: vi.fn().mockResolvedValue(0),
        },
        archive: buildArchive(),
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

    return { supervisor, log, listContracts, setNowMs: (next) => { nowMs = next; } };
}

describe('CollectorSupervisor liveness', () => {
    let harness: Harness;

    beforeEach(async () => {
        harness = buildHarness([buildContract('BTCUSDT'), buildContract('ETHUSDT')]);
        await harness.supervisor.start();
    });

    it('brings up every enabled contract', () => {
        expect([...harness.supervisor.recording].sort()).toEqual(['BTCUSDT', 'ETHUSDT']);
    });

    it('keeps a collector that has not yet had time to record', async () => {
        harness.setNowMs(1_000_000 + STALL_TIMEOUT_MS - 1);

        await harness.supervisor.reconcileNow();

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

        expect([...harness.supervisor.recording].sort()).toEqual(['BTCUSDT', 'ETHUSDT']);
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
