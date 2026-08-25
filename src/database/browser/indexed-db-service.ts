import { createStores, DATABASE_NAME, SCHEMA_VERSION } from './browser-schema.ts';

/** Raised when the browser refuses a read or a write. */
export class IndexedDbQueryError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = 'IndexedDbQueryError';
    }
}

export interface IndexedDbServiceConfig {
    /** Absent outside a browser, which is how a test runs the callers. */
    readonly factory: IDBFactory | null;
}

/**
 * The only place browser storage is spoken.
 *
 * Callers get transactions and cursors shaped by their own record types, so no
 * IndexedDB type reaches the rest of the codebase and the connection's lifetime
 * stays in one place — the same arrangement the PostgreSQL pool has.
 */
export class IndexedDbService {
    private readonly factory: IDBFactory | null;
    private connection: IDBDatabase | null = null;

    constructor(config: IndexedDbServiceConfig) {
        this.factory = config.factory;
        this.handleVersionChange = this.handleVersionChange.bind(this);
    }

    /**
     * Opens the connection, creating the stores when the page is new.
     *
     * @throws IndexedDbQueryError when storage is unavailable or the open is refused.
     */
    async open(): Promise<void> {
        if (this.factory === null) {
            throw new IndexedDbQueryError('This browser exposes no IndexedDB');
        }
        if (this.connection !== null) {
            return;
        }

        const request = this.factory.open(DATABASE_NAME, SCHEMA_VERSION);
        request.onupgradeneeded = () => { createStores(request.result); };

        this.connection = await new Promise<IDBDatabase>((resolve, reject) => {
            request.onsuccess = () => { resolve(request.result); };
            request.onerror = () => {
                reject(new IndexedDbQueryError('Could not open the local archive', {
                    cause: request.error,
                }));
            };
            // Fired when another tab holds a connection at an older version and
            // will not let go. Nothing here can fix that, so say so rather than
            // hang on a promise that will never settle.
            request.onblocked = () => {
                reject(new IndexedDbQueryError('Another tab is holding an older version open'));
            };
        });

        this.connection.addEventListener('versionchange', this.handleVersionChange);
    }

    /**
     * Closes the connection. Safe in any state.
     */
    close(): void {
        this.connection?.removeEventListener('versionchange', this.handleVersionChange);
        this.connection?.close();
        this.connection = null;
    }

    /**
     * Runs work inside one transaction and settles when it commits.
     *
     * @param storeNames - Stores the work touches.
     * @param mode - Whether the work writes.
     * @param work - Given the stores, in the order they were named.
     * @returns Whatever the work returned, once the transaction committed.
     * @throws IndexedDbQueryError when the transaction aborts.
     */
    async transact<TResult>(
        storeNames: readonly string[],
        mode: IDBTransactionMode,
        work: (stores: readonly IDBObjectStore[]) => TResult,
    ): Promise<TResult> {
        const database = this.require();
        const transaction = database.transaction([...storeNames], mode);
        const stores = storeNames.map((name) => transaction.objectStore(name));

        const result = work(stores);
        await new Promise<void>((resolve, reject) => {
            transaction.oncomplete = () => { resolve(); };
            transaction.onabort = () => {
                reject(new IndexedDbQueryError('The local archive aborted a transaction', {
                    cause: transaction.error,
                }));
            };
        });
        return result;
    }

    /**
     * Reads every record a range covers, in key order.
     *
     * @param storeName - Store to scan.
     * @param range - Which keys, or null for all of them.
     * @param limit - Stop after this many records.
     * @returns The records, oldest key first.
     */
    async readRange<TRecord>(
        storeName: string,
        range: IDBKeyRange | null,
        limit = Number.POSITIVE_INFINITY,
    ): Promise<TRecord[]> {
        const found: TRecord[] = [];
        await this.transact([storeName], 'readonly', ([store]) => {
            const request = store!.openCursor(range);
            request.onsuccess = () => {
                const cursor = request.result;
                if (cursor === null || found.length >= limit) {
                    return;
                }
                found.push(cursor.value as TRecord);
                cursor.continue();
            };
        });
        return found;
    }

    /**
     * Counts the records a range covers.
     *
     * @param storeName - Store to count in.
     * @param range - Which keys, or null for all of them.
     * @returns How many there are.
     */
    async countRange(storeName: string, range: IDBKeyRange | null): Promise<number> {
        let total = 0;
        await this.transact([storeName], 'readonly', ([store]) => {
            const request = store!.count(range ?? undefined);
            request.onsuccess = () => { total = request.result; };
        });
        return total;
    }

    private require(): IDBDatabase {
        if (this.connection === null) {
            throw new IndexedDbQueryError('The local archive is not open');
        }
        return this.connection;
    }

    /**
     * Lets go when another tab needs to upgrade the schema.
     *
     * Holding on would block that tab forever, so the connection is dropped and
     * this page degrades to whatever it already loaded.
     */
    private handleVersionChange(): void {
        this.close();
    }
}
