import 'fake-indexeddb/auto';
import { recordInstants } from '../../mocks/browser-recording.ts';
import { IndexedDbChunkRowStore } from '../../../src/database/browser/indexed-db-chunk-row-store.ts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MINIMUM_BUDGET_BYTES } from '../../../src/shared/core/recording-control.ts';
import { BrowserRecordingControl } from '../../../src/database/browser/browser-recording-control.ts';
import { FIRST_VENUE } from '../../../src/shared/core/recording-control.ts';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbLiquidityArchive } from '../../../src/database/browser/indexed-db-liquidity-archive.ts';
import { IndexedDbService } from '../../../src/database/browser/indexed-db-service.ts';
import type { RecordedContract } from '../../../src/shared/core/recording-control.ts';

const CATALOGUE: readonly RecordedContract[] = [
    { venue: FIRST_VENUE, instrumentSymbol: 'BTCUSDT', priceBucketSize: 10, frameIntervalMs: 1_000, isEnabled: true },
    { venue: FIRST_VENUE, instrumentSymbol: 'ETHUSDT', priceBucketSize: 0.5, frameIntervalMs: 1_000, isEnabled: false },
];

describe('BrowserRecordingControl', () => {
    let database: IndexedDbService;
    let archive: IndexedDbLiquidityArchive;
    let estimate: StorageEstimate;

    function buildControl(): BrowserRecordingControl {
        return new BrowserRecordingControl({
            archive,
            database,
            estimateStorage: () => Promise.resolve(estimate),
            catalogue: CATALOGUE,
        });
    }

    beforeEach(async () => {
        database = new IndexedDbService({ factory: new IDBFactory() });
        archive = new IndexedDbLiquidityArchive({
            database,
            chunks: new IndexedDbChunkRowStore({ database }),
        });
        estimate = { quota: 4_000_000_000, usage: 1_000 };
        await archive.open();
    });

    it('offers the catalogue as it stands to a first-time visitor', async () => {
        const offered = await buildControl().listContracts();

        expect(offered.map((contract) => contract.isEnabled)).toEqual([true, false]);
    });

    it('reopens on the choice the reader made, not the one it ships with', async () => {
        await buildControl().saveContract({ ...CATALOGUE[1]!, isEnabled: true });

        // A second instance, because the choice has to survive the page and not
        // just the object that wrote it.
        const reopened = await buildControl().listContracts();

        expect(reopened.find((c) => c.instrumentSymbol === 'ETHUSDT')?.isEnabled).toBe(true);
    });

    it('keeps the ceiling when a contract is switched', async () => {
        // Both live in one stored row, so each writer has to carry the other's
        // half forward or the last one to write erases it.
        const control = buildControl();
        const chosen = MINIMUM_BUDGET_BYTES * 2;
        await control.setBudget(chosen);

        await control.saveContract({ ...CATALOGUE[1]!, isEnabled: true });

        expect((await control.readBudget()).maximumBytes).toBe(chosen);
    });

    it('keeps the contracts when the ceiling is changed', async () => {
        const control = buildControl();
        await control.saveContract({ ...CATALOGUE[1]!, isEnabled: true });

        await control.setBudget(2_000_000);

        expect((await control.listContracts()).find((c) => c.instrumentSymbol === 'ETHUSDT')?.isEnabled)
            .toBe(true);
    });

    it('takes a quarter of the quota until the reader picks a ceiling', async () => {
        // Asserted as a share of whatever the host offers rather than as the
        // one product: the literal is the arithmetic's answer, so the
        // arithmetic could be deleted and replaced by it.
        const budget = await buildControl().readBudget();

        expect(budget.availableBytes).toBe(4_000_000_000);
        expect(budget.maximumBytes).toBe(Math.floor(4_000_000_000 / 4));
    });

    it('takes the same quarter of a different quota', async () => {
        estimate = { quota: 8_000_000_000, usage: 0 };

        expect((await buildControl().readBudget()).maximumBytes)
            .toBe(Math.floor(8_000_000_000 / 4));
    });

    it('says the host will not name a quota rather than inventing one', async () => {
        estimate = {};

        expect(await buildControl().readBudget()).toMatchObject({
            maximumBytes: 0,
            usedBytes: 0,
            availableBytes: null,
        });
    });

    it('drops nothing while the recording still fits', async () => {
        // Asserted as "the archive was never asked", because zero is also what
        // the loop returns over an archive that held nothing to drop: the early
        // return could be deleted and this still passed.
        estimate = { quota: 4_000_000_000, usage: 10 };
        const asked = vi.spyOn(archive, 'pruneToCapacity');

        expect(await buildControl().pruneToBudget()).toBe(0);
        expect(asked).not.toHaveBeenCalled();
    });

    it('splits what may be kept across the contracts being recorded', async () => {
        // A host with almost no room to offer, rather than a ceiling the reader
        // chose: a choice is clamped to a real amount of storage, and a quota is
        // whatever the host actually has.
        const control = buildControl();
        estimate = { quota: 10_400, usage: 999_999 };
        await control.saveContract({ ...CATALOGUE[1]!, isEnabled: true });
        for (const instrumentSymbol of ['BTCUSDT', 'ETHUSDT']) {
            await recordInstants({ database, instrumentSymbol, fromMs: 1_000_000, count: 5 });
        }

        const dropped = await control.pruneToBudget();

        // Split between them rather than spent on whichever was asked first:
        // a busy contract must not prune a quiet one out of existence.
        expect(dropped).toBeGreaterThan(0);
        expect(await archive.findLastFrameTimestamp('ETHUSDT')).toBe(1_004_000);
    });
});
