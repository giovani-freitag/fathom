import { beforeEach, describe, expect, it } from 'vitest';
import { createPostgresServiceMock, type PostgresServiceMock } from '../../mocks/postgres-service.ts';
import { RecordingControlService } from '../../../src/database/services/recording-control-service.ts';

/** Every store the collector writes to, which is what the budget answers for. */
const RECORDED_TABLES = [
    'trade_cluster',
    'whole_book.liquidity_block',
    'whole_book.liquidity_chunk',
];

/** The statements the service sent, joined so a test can look for a name in them. */
function statementsOf(postgres: PostgresServiceMock): string {
    return [
        ...postgres.selectRows.mock.calls.map((call) => String(call[0])),
        ...postgres.execute.mock.calls.map((call) => String(call[0])),
    ].join('\n');
}

describe('RecordingControlService reading the budget', () => {
    let postgres: PostgresServiceMock;
    let control: RecordingControlService;

    beforeEach(() => {
        postgres = createPostgresServiceMock();
        control = new RecordingControlService({ postgres: postgres.service });
        postgres.selectRows.mockResolvedValue([{ maximum_bytes: '100', used_bytes: '40' }]);
    });

    it('counts every store the collector writes to', async () => {
        // A store left out of the count is a store nothing prunes: it never
        // shows in what the reader is told they are using, and it goes on
        // growing after the budget has started dropping the rest.
        await control.readBudget();

        const asked = statementsOf(postgres);

        expect(RECORDED_TABLES.filter((table) => !asked.includes(`hypertable_size('${table}')`)))
            .toEqual([]);
    });

    it('answers with both figures in bytes', async () => {
        expect(await control.readBudget()).toMatchObject({ maximumBytes: 100, usedBytes: 40 });
    });

    it('leaves the ceiling of the volume to the reader to judge', async () => {
        expect((await control.readBudget()).availableBytes).toBeNull();
    });

    it('reads nothing as nothing rather than as a budget of its own', async () => {
        postgres.selectRows.mockResolvedValue([]);

        expect(await control.readBudget()).toMatchObject({ maximumBytes: 0, usedBytes: 0 });
    });
});

describe('RecordingControlService pruning to the budget', () => {
    let postgres: PostgresServiceMock;
    let control: RecordingControlService;

    beforeEach(() => {
        postgres = createPostgresServiceMock();
        control = new RecordingControlService({ postgres: postgres.service });
    });

    /** Answers the budget read, then the boundary read, then the budget again. */
    function answerWith(readings: { used: number; maximum: number }[], boundary: string | null) {
        let call = 0;
        postgres.selectRows.mockImplementation((statement: string) => {
            if (String(statement).includes('recording_budget')) {
                const reading = readings[Math.min(call++, readings.length - 1)]!;
                return Promise.resolve([
                    { maximum_bytes: String(reading.maximum), used_bytes: String(reading.used) },
                ]);
            }
            // Two rows, because the newest partition is the one being written
            // into and is never the one taken.
            return Promise.resolve(boundary === null
                ? []
                : [{ range_end: new Date(boundary) }, { range_end: new Date(boundary) }]);
        });
    }

    it('drops nothing while the recording fits', async () => {
        answerWith([{ used: 40, maximum: 100 }], '2026-01-01T00:00:00Z');

        expect(await control.pruneToBudget()).toBe(0);
    });

    it('drops the oldest partition of every store it counts', async () => {
        // Dropping some stores at a boundary and not others leaves the archive
        // saying two different things about the same stretch of time.
        answerWith([{ used: 400, maximum: 100 }, { used: 40, maximum: 100 }], '2026-01-01T00:00:00Z');

        await control.pruneToBudget();

        const ran = statementsOf(postgres);
        expect(RECORDED_TABLES.filter((table) => !ran.includes(`drop_chunks('${table}'`)))
            .toEqual([]);
    });

    it('files what it is about to drop before it drops it', async () => {
        // Afterwards there is nothing left to ask, and the archive could not
        // tell a stretch it never saw from one it deleted.
        answerWith([{ used: 400, maximum: 100 }, { used: 40, maximum: 100 }], '2026-01-01T00:00:00Z');

        await control.pruneToBudget();

        const order = postgres.execute.mock.calls.map((call) => String(call[0]));
        const filed = order.findIndex((statement) => statement.includes('recording_gap'));
        const dropped = order.findIndex((statement) => statement.includes('drop_chunks'));

        expect(filed).toBeGreaterThanOrEqual(0);
        expect(filed).toBeLessThan(dropped);
    });

    it('stops rather than spinning when there is nothing left to drop', async () => {
        answerWith([{ used: 400, maximum: 100 }], null);

        expect(await control.pruneToBudget()).toBe(0);
    });

    it('keeps dropping while the recording is still over', async () => {
        answerWith(
            [{ used: 400, maximum: 100 }, { used: 300, maximum: 100 }, { used: 40, maximum: 100 }],
            '2026-01-01T00:00:00Z',
        );

        expect(await control.pruneToBudget()).toBe(2);
    });
});
