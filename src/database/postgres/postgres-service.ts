import { parseQuantityLiteral } from './postgres-row-mapping.ts';
import pg from 'pg';

/**
 * Object identifier PostgreSQL uses for `real[]`.
 */
const REAL_ARRAY_TYPE_OID = 1_021 as unknown as Parameters<typeof pg.types.setTypeParser>[0];

// Registered once for the process: the driver's own array parser is the single
// largest cost of reading a wide window, and every `real[]` this project selects
// is a depth ladder that is about to become a typed array anyway.
pg.types.setTypeParser(REAL_ARRAY_TYPE_OID, parseQuantityLiteral);

export interface PostgresServiceConfig {
    readonly connectionString: string;
    readonly maximumPoolSize: number;
    readonly statementTimeoutMs: number;
}

/** Raised when the database rejects or cannot serve a statement. */
export class PostgresQueryError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = 'PostgresQueryError';
    }
}

/**
 * The only place the PostgreSQL driver is used.
 */
interface ChannelListener {
    readonly client: pg.PoolClient;
    readonly onNotification: (payload: string) => void;
}

export class PostgresService {
    private readonly config: PostgresServiceConfig;
    private connectionPool: pg.Pool | null = null;
    private readonly listeners = new Map<string, ChannelListener>();
    private wasClosed = false;

    constructor(config: PostgresServiceConfig) {
        this.config = config;
        this.handlePoolError = this.handlePoolError.bind(this);
    }

    /**
     * Opens the connection pool and proves the database answers.
     *
     * @throws PostgresQueryError when the first connection cannot be established.
     */
    async connect(): Promise<void> {
        if (this.wasClosed) {
            throw new PostgresQueryError('This service was closed and cannot be reconnected');
        }
        if (this.connectionPool !== null) {
            return;
        }

        const connectionPool = new pg.Pool({
            connectionString: this.config.connectionString,
            max: this.config.maximumPoolSize,
            idleTimeoutMillis: 30_000,
            connectionTimeoutMillis: 10_000,
            statement_timeout: this.config.statementTimeoutMs,
        });
        connectionPool.on('error', this.handlePoolError);
        this.connectionPool = connectionPool;

        try {
            await connectionPool.query('SELECT 1');
        } catch (error) {
            this.connectionPool = null;
            await connectionPool.end().catch(() => undefined);
            throw new PostgresQueryError('Database did not answer the connection probe', { cause: error });
        }
    }

    /**
     * Drains the pool and marks the service dead.
     */
    async close(): Promise<void> {
        this.wasClosed = true;
        const connectionPool = this.connectionPool;
        this.connectionPool = null;
        if (connectionPool === null) {
            return;
        }
        for (const listener of this.listeners.values()) {
            listener.client.release(true);
        }
        this.listeners.clear();

        connectionPool.off('error', this.handlePoolError);
        await connectionPool.end().catch(() => undefined);
    }

    /**
     * Runs a statement and returns its rows.
     *
     * @param statement - SQL text with positional placeholders.
     * @param parameters - Values bound to the placeholders, in order.
     * @returns The result rows, shaped by the caller's type argument.
     * @throws PostgresQueryError when the service is not connected or the statement fails.
     */
    async selectRows<TRow>(statement: string, parameters: readonly unknown[] = []): Promise<TRow[]> {
        const connectionPool = this.requireConnectionPool();
        try {
            // Copied rather than cast: the driver's signature is mutable, and a
            // caller's readonly array has no business being handed to it.
            const result = await connectionPool.query<TRow extends pg.QueryResultRow ? TRow : never>(
                statement,
                [...parameters],
            );
            return result.rows;
        } catch (error) {
            throw new PostgresQueryError(describeFailure(statement, error), { cause: error });
        }
    }

    /**
     * Runs a statement that returns no rows.
     *
     * @param statement - SQL text with positional placeholders.
     * @param parameters - Values bound to the placeholders, in order.
     * @returns Number of rows the statement affected.
     * @throws PostgresQueryError when the service is not connected or the statement fails.
     */
    async execute(statement: string, parameters: readonly unknown[] = []): Promise<number> {
        const connectionPool = this.requireConnectionPool();
        try {
            const result = await connectionPool.query(statement, [...parameters]);
            return result.rowCount ?? 0;
        } catch (error) {
            throw new PostgresQueryError(describeFailure(statement, error), { cause: error });
        }
    }

    /**
     * Announces something on a channel, for whoever is listening.
     *
     * @param channel - The channel name.
     * @param payload - What to say, under eight kilobytes.
     * @throws PostgresQueryError when the service is not connected.
     */
    async notify(channel: string, payload: string): Promise<void> {
        await this.execute('SELECT pg_notify($1, $2)', [channel, payload]);
    }

    /**
     * Follows a channel until the service closes.
     *
     * @param channel - The channel name.
     * @param onNotification - Called with each payload, in arrival order.
     * @throws PostgresQueryError when the service is not connected.
     */
    async listen(channel: string, onNotification: (payload: string) => void): Promise<void> {
        const pool = this.requireConnectionPool();
        // A dedicated client, not a pooled checkout: a LISTEN belongs to the
        // connection that issued it, and a client handed back to the pool stops
        // hearing anything without saying so.
        const client = await pool.connect();
        this.listeners.set(channel, { client, onNotification });

        client.on('notification', (notification) => {
            if (notification.channel === channel) {
                onNotification(notification.payload ?? '');
            }
        });
        client.on('error', () => { void this.relisten(channel); });
        await client.query(`LISTEN ${pg.escapeIdentifier(channel)}`);
    }

    /**
     * Opens a fresh connection for a channel whose own has died.
     */
    private async relisten(channel: string): Promise<void> {
        const listener = this.listeners.get(channel);
        this.listeners.delete(channel);
        if (listener === undefined || this.wasClosed) {
            return;
        }
        listener.client.release(true);

        try {
            await this.listen(channel, listener.onNotification);
        } catch {
            // The pool is down, which the next write will report anyway. The
            // readers fall back to their own interval until it answers again.
        }
    }

    private requireConnectionPool(): pg.Pool {
        if (this.connectionPool === null) {
            throw new PostgresQueryError('Service is not connected');
        }
        return this.connectionPool;
    }

    private handlePoolError(error: Error): void {
        // An idle client dying is normal after a database restart; the pool
        // replaces it on the next checkout. Swallowing the event only matters
        // because an unhandled 'error' on a pg Pool terminates the process.
        process.emitWarning(`Idle database client failed: ${error.message}`, 'PostgresService');
    }
}

function describeFailure(statement: string, error: unknown): string {
    const firstLine = statement.trim().split('\n', 1)[0] ?? '';
    const reason = error instanceof Error ? error.message : String(error);
    return `Statement failed (${firstLine}): ${reason}`;
}
