import { EventEmitter } from 'node:events';
import { vi } from 'vitest';

/** One pooled connection, with the events the driver emits on it. */
export class FakePoolClient extends EventEmitter {
    readonly query = vi.fn<(statement: string) => Promise<{ rows: unknown[]; rowCount: number }>>(
        () => Promise.resolve({ rows: [], rowCount: 0 }),
    );

    readonly release = vi.fn<(destroy?: boolean) => void>();
}

/** A pool that answers whatever a test told it to, and remembers its clients. */
export class FakePool extends EventEmitter {
    static readonly opened: FakePool[] = [];
    /** Applied to the next pool the service opens, once. */
    static pendingSetUp: ((pool: FakePool) => void) | null = null;

    readonly options: unknown;
    readonly clients: FakePoolClient[] = [];
    readonly query = vi.fn<(statement: string, parameters?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }>>(
        () => Promise.resolve({ rows: [], rowCount: 0 }),
    );

    readonly end = vi.fn<() => Promise<void>>(() => Promise.resolve());
    readonly connect = vi.fn<() => Promise<FakePoolClient>>(() => {
        const client = new FakePoolClient();
        this.clients.push(client);
        return Promise.resolve(client);
    });

    constructor(options: unknown) {
        super();
        this.options = options;
        FakePool.opened.push(this);
        const setUp = FakePool.pendingSetUp;
        FakePool.pendingSetUp = null;
        setUp?.(this);
    }
}

/** The last pool the service opened. */
export function readLastPool(): FakePool {
    const pool = FakePool.opened.at(-1);
    if (pool === undefined) {
        throw new Error('No pool was opened');
    }
    return pool;
}

/** Forgets every pool a previous test opened. */
export function forgetPools(): void {
    FakePool.opened.length = 0;
    FakePool.pendingSetUp = null;
}

/**
 * Prepares the next pool before the service gets to use it.
 *
 * @param setUp - Given the pool, at construction.
 */
export function configureNextPool(setUp: (pool: FakePool) => void): void {
    FakePool.pendingSetUp = setUp;
}

const driver = {
    Pool: FakePool,
    types: { setTypeParser: vi.fn() },
    escapeIdentifier: (name: string) => `"${name.replaceAll('"', '""')}"`,
};

export default driver;
