import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('pg', async () => import('../../mocks/pg.ts'));

import { configureNextPool, forgetPools, readLastPool, type FakePoolClient } from '../../mocks/pg.ts';
import {
    PostgresQueryError,
    PostgresService,
} from '../../../src/database/postgres/postgres-service.ts';
import { delay } from '../../../src/shared/core/timers.ts';

function buildService(): PostgresService {
    return new PostgresService({
        connectionString: 'postgres://fathom@localhost/fathom',
        maximumPoolSize: 4,
        statementTimeoutMs: 5_000,
        channelRetryDelayMs: 1,
    });
}

/** A connected service, with the pool it opened. */
async function buildConnected(): Promise<{ service: PostgresService; pool: ReturnType<typeof readLastPool> }> {
    const service = buildService();
    await service.connect();
    return { service, pool: readLastPool() };
}

describe('PostgresService connecting', () => {
    beforeEach(() => { forgetPools(); });

    it('proves the database answers before reporting itself open', async () => {
        const service = buildService();

        await service.connect();

        expect(readLastPool().query).toHaveBeenCalledWith('SELECT 1');
    });

    it('opens one pool however many times it is asked', async () => {
        const service = buildService();

        await service.connect();
        await service.connect();

        expect(readLastPool().query).toHaveBeenCalledTimes(1);
    });

    it('refuses to report itself open when the probe fails', async () => {
        configureNextPool((pool) => {
            pool.query.mockRejectedValue(new Error('connection refused'));
        });
        const service = buildService();

        await expect(service.connect()).rejects.toThrow(PostgresQueryError);
    });

    it('drains the pool it could not prove', async () => {
        // Left open, its idle clients keep retrying a database that refused, and
        // the process never exits.
        configureNextPool((pool) => {
            pool.query.mockRejectedValue(new Error('connection refused'));
        });
        const service = buildService();

        await service.connect().catch(() => undefined);

        expect(readLastPool().end).toHaveBeenCalled();
    });

    it('can be opened again after a probe that failed', async () => {
        configureNextPool((pool) => {
            pool.query.mockRejectedValueOnce(new Error('connection refused'));
        });
        const service = buildService();
        await service.connect().catch(() => undefined);

        await service.connect();

        expect(readLastPool().query).toHaveBeenCalledWith('SELECT 1');
    });

    it('cannot be reopened once it has been closed', async () => {
        const { service } = await buildConnected();
        await service.close();

        await expect(service.connect()).rejects.toThrow(PostgresQueryError);
    });
});

describe('PostgresService running statements', () => {
    beforeEach(() => { forgetPools(); });

    it('refuses a statement before it is connected', async () => {
        const service = buildService();

        await expect(service.selectRows('SELECT 1')).rejects.toThrow(PostgresQueryError);
    });

    it('names the statement that failed', async () => {
        const { service, pool } = await buildConnected();
        pool.query.mockRejectedValueOnce(new Error('relation does not exist'));

        await expect(service.selectRows('SELECT * FROM missing\nWHERE id = $1', [1]))
            .rejects.toThrow('Statement failed (SELECT * FROM missing): relation does not exist');
    });

    it('reports no rows affected when the driver counted none', async () => {
        const { service, pool } = await buildConnected();
        pool.query.mockResolvedValueOnce({ rows: [], rowCount: null });

        await expect(service.execute('DELETE FROM frames')).resolves.toBe(0);
    });
});

describe('PostgresService following a channel', () => {
    let service: PostgresService;
    let pool: ReturnType<typeof readLastPool>;

    beforeEach(async () => {
        forgetPools();
        ({ service, pool } = await buildConnected());
    });

    afterEach(async () => { await service.close(); });

    it('takes a connection of its own out of the pool', async () => {
        await service.listen('recording', () => undefined);

        expect(pool.connect).toHaveBeenCalledTimes(1);
    });

    it('reports what the channel announced', async () => {
        const announced: string[] = [];
        await service.listen('recording', (payload) => { announced.push(payload); });

        pool.clients[0]!.emit('notification', { channel: 'recording', payload: 'BTCUSDT' });

        expect(announced).toEqual(['BTCUSDT']);
    });

    it('ignores what another channel announced on the same connection', async () => {
        const announced: string[] = [];
        await service.listen('recording', (payload) => { announced.push(payload); });

        pool.clients[0]!.emit('notification', { channel: 'something else', payload: 'BTCUSDT' });

        expect(announced).toEqual([]);
    });

    it('follows the channel again after its connection died', async () => {
        await service.listen('recording', () => undefined);

        pool.clients[0]!.emit('error', new Error('connection terminated'));
        await vi.waitFor(() => { expect(pool.connect).toHaveBeenCalledTimes(2); });

        expect(pool.clients[0]!.release).toHaveBeenCalledWith(true);
    });

    it('keeps following a channel whose first recovery attempt failed', async () => {
        // Without another attempt the gateway hears nothing more for the life of
        // the process, and every viewer silently falls back to polling.
        await service.listen('recording', () => undefined);
        pool.connect.mockRejectedValueOnce(new Error('pool exhausted'));

        pool.clients[0]!.emit('error', new Error('connection terminated'));

        await vi.waitFor(() => { expect(pool.connect).toHaveBeenCalledTimes(3); }, { timeout: 3_000 });
    });

    it('lets go of the connection a second listen replaced', async () => {
        // Left checked out, it is never returned and never heard from again: a
        // few of those and the pool has nothing left to hand out.
        await service.listen('recording', () => undefined);
        const replaced: FakePoolClient = pool.clients[0]!;

        await service.listen('recording', () => undefined);

        expect(replaced.release).toHaveBeenCalledWith(true);
    });

    it('goes deaf to the connection it was following once it is closed', async () => {
        // Still attached, the connection's own dying error is read as a channel
        // to follow again, out of a pool that is already draining.
        await service.listen('recording', () => undefined);
        const client: FakePoolClient = pool.clients[0]!;

        await service.close();

        expect(client.listenerCount('error')).toBe(0);
    });

    it('hands the following connection back destroyed', async () => {
        await service.listen('recording', () => undefined);
        const client: FakePoolClient = pool.clients[0]!;

        await service.close();

        expect(client.release).toHaveBeenCalledWith(true);
    });

    it('gives up recovering a channel once the service is closed', async () => {
        // The pool is draining and every further attempt is one more connection
        // request against a database the process is done with.
        await service.listen('recording', () => undefined);
        pool.connect.mockRejectedValue(new Error('pool exhausted'));
        pool.clients[0]!.emit('error', new Error('connection terminated'));
        await vi.waitFor(() => { expect(pool.connect.mock.calls.length).toBeGreaterThan(2); });

        await service.close();
        const attemptsAtClose = pool.connect.mock.calls.length;
        await delay(30);

        expect(pool.connect.mock.calls.length).toBe(attemptsAtClose);
    });
});
