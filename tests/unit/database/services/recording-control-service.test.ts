import { beforeEach, describe, expect, it } from 'vitest';
import { createPostgresServiceMock, type PostgresServiceMock } from '../../../mocks/postgres-service.ts';
import { RecordingControlService } from '../../../../src/database/services/recording-control-service.ts';

const GIGABYTE = 1_073_741_824;

function buildService(mock: PostgresServiceMock): RecordingControlService {
    return new RecordingControlService({ postgres: mock.service });
}

/** Answers the budget read with a use that shrinks by one chunk per drop. */
function stubShrinkingArchive(mock: PostgresServiceMock, usedBytes: number[], chunkEnd: Date): void {
    let reading = 0;
    mock.selectRows.mockImplementation((statement: string): Promise<unknown[]> => {
        if (statement.includes('recording_budget')) {
            const used = usedBytes[Math.min(reading, usedBytes.length - 1)] ?? 0;
            reading += 1;
            return Promise.resolve([{ maximum_bytes: String(GIGABYTE), used_bytes: String(used) }]);
        }
        if (statement.includes('timescaledb_information.chunks')) {
            return Promise.resolve([{ range_end: chunkEnd }]);
        }
        return Promise.resolve([]);
    });
}

describe('RecordingControlService.pruneToBudget', () => {
    let mock: PostgresServiceMock;

    beforeEach(() => {
        mock = createPostgresServiceMock();
    });

    it('drops nothing while the recording fits', async () => {
        stubShrinkingArchive(mock, [GIGABYTE - 1], new Date());

        expect(await buildService(mock).pruneToBudget()).toBe(0);
    });

    it('drops until the recording fits again', async () => {
        stubShrinkingArchive(mock, [GIGABYTE * 3, GIGABYTE * 2, GIGABYTE - 1], new Date());

        expect(await buildService(mock).pruneToBudget()).toBe(2);
    });

    it('drops whole partitions rather than deleting rows', async () => {
        stubShrinkingArchive(mock, [GIGABYTE * 2, GIGABYTE - 1], new Date());

        await buildService(mock).pruneToBudget();

        const statements = mock.execute.mock.calls.map((call) => String(call[0]));
        expect(statements.every((statement) => statement.includes('drop_chunks'))).toBe(true);
    });

    it('takes both hypertables to the same boundary, so trades never outlive frames', async () => {
        stubShrinkingArchive(mock, [GIGABYTE * 2, GIGABYTE - 1], new Date());

        await buildService(mock).pruneToBudget();

        const statement = String(mock.execute.mock.calls[0]?.[0]);
        expect([statement.includes('liquidity_frame'), statement.includes('trade_cluster')])
            .toEqual([true, true]);
    });

    it('stops rather than looping when there is nothing left to drop', async () => {
        let reading = 0;
        mock.selectRows.mockImplementation((statement: string): Promise<unknown[]> => {
            if (statement.includes('recording_budget')) {
                reading += 1;
                return Promise.resolve([{ maximum_bytes: '1', used_bytes: String(GIGABYTE) }]);
            }
            return Promise.resolve([]);
        });

        expect([await buildService(mock).pruneToBudget(), reading]).toEqual([0, 1]);
    });
});

describe('RecordingControlService', () => {
    it('keeps what a disabled instrument already recorded', async () => {
        const mock = createPostgresServiceMock();

        await buildService(mock).setEnabled('BTCUSDT', false);

        const statement = String(mock.execute.mock.calls[0]?.[0]);
        expect([statement.includes('UPDATE'), statement.includes('DELETE')]).toEqual([true, false]);
    });

    it('refuses a budget of zero, which would erase everything', async () => {
        const mock = createPostgresServiceMock();

        await buildService(mock).setBudget(0);

        const bound = mock.execute.mock.calls[0]?.[1] as readonly number[] | undefined;
        expect(Number(bound?.[0])).toBeGreaterThan(0);
    });
});
