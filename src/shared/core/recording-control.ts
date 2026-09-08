/**
 * The connector every recording came from before there was more than one.
 *
 * Named here rather than assumed at each call site: it is what a contract with
 * no venue on it meant, and the migration that added the column backfilled it
 * with this exact string.
 */
export const FIRST_VENUE = 'binance-futures';

/**
 * What names a contract: the venue and the symbol, never the symbol alone.
 *
 * Written here because both halves of the recording key contracts this way —
 * the supervisor deciding which collector is already running, and the recorder
 * deciding which levels a frame belongs to. Two spellings of the same key would
 * agree until one of them was changed.
 *
 * @param contract - The contract to name.
 * @returns Its key.
 */
export function nameContract(contract: ContractIdentity): string {
    return `${contract.venue}/${contract.instrumentSymbol}`;
}

/** The two halves that name a contract, and nothing else about it. */
export interface ContractIdentity {
    readonly venue: string;
    readonly instrumentSymbol: string;
}

/** One contract a supervisor may record, and the grid it records on. */
/**
 * A change to what is recorded that this page will not make.
 *
 * Named rather than described, and thrown rather than returned. The sentence a
 * reader is shown belongs to whoever reads it, so the message here — written
 * for whoever wrote the rule — is not the one that reaches the screen: the
 * count travels with it and the interface says it in the reader's own words.
 */
export class RecordingRefusedError extends Error {
    /** How many contracts a page will record at once. */
    readonly most: number;

    constructor(most: number) {
        super(`A page records at most ${String(most)} contracts at once.`);
        this.name = 'RecordingRefusedError';
        this.most = most;
    }
}

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

/**
 * The least storage a reader may set a recording's ceiling to.
 *
 * One number, because it was three: the wire refused anything under a gibibyte
 * while both controls clamped at a single byte, so the property the test names
 * — that a ceiling is a real amount of room — held only on the path the test
 * did not take.
 *
 * Sixty-four mebibytes rather than the gibibyte the wire used to insist on. A
 * browser was measured offering two gibibytes in all, so a gibibyte floor put
 * half of everything the host had below the least a reader could choose.
 *
 * This is a floor on a choice, not on what a host offers: a browser whose whole
 * quota is smaller than this still records into the share of it that exists.
 */
export const MINIMUM_BUDGET_BYTES = 67_108_864;

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
    /**
     * Takes a contract off the list and deletes what it recorded.
     *
     * Apart from switching one off, which keeps everything it captured. This is
     * the other decision, and the one that cannot be taken back: an order book
     * cannot be recorded again, so what goes here is gone.
     *
     * @param venue - Which connector the symbol belongs to.
     * @param instrumentSymbol - Which contract.
     */
    removeContract(venue: string, instrumentSymbol: string): Promise<void>;
    readBudget(): Promise<StorageBudget>;
    setBudget(maximumBytes: number): Promise<void>;
    /**
     * Drops the oldest history until the recording fits its budget.
     *
     * @returns How much was dropped, in whatever unit the engine drops in.
     */
    pruneToBudget(): Promise<number>;
}
