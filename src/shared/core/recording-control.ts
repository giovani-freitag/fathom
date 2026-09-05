/**
 * The connector every recording came from before there was more than one.
 *
 * Named here rather than assumed at each call site: it is what a contract with
 * no venue on it meant, and the migration that added the column backfilled it
 * with this exact string.
 */
export const FIRST_VENUE = 'binance-futures';

/** One contract a supervisor may record, and the grid it records on. */
export interface RecordedContract {
    /**
     * Which connector the symbol belongs to.
     *
     * Part of what names a contract, not a label on it: two venues both list
     * BTCUSDT, and keyed by the symbol alone the second to register would take
     * the grid of the first while a recording was already running on the old one.
     */
    readonly venue: string;
    readonly instrumentSymbol: string;
    readonly priceBucketSize: number;
    readonly frameIntervalMs: number;
    readonly isEnabled: boolean;
}

/** How much storage the whole recording may take, what it takes, and what exists. */
export interface StorageBudget {
    /** The ceiling in force. */
    readonly maximumBytes: number;
    /** What the recording occupies right now. */
    readonly usedBytes: number;
    /**
     * The most this host could ever offer, or null when it will not say.
     */
    readonly availableBytes: number | null;
}

/**
 * What should be recorded, and how much room it has.
 */
export interface RecordingControl {
    listContracts(): Promise<readonly RecordedContract[]>;
    saveContract(contract: RecordedContract): Promise<void>;
    readBudget(): Promise<StorageBudget>;
    setBudget(maximumBytes: number): Promise<void>;
    /**
     * Drops the oldest history until the recording fits its budget.
     *
     * @returns How much was dropped, in whatever unit the engine drops in.
     */
    pruneToBudget(): Promise<number>;
}
