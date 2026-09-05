import type {
    RecordedContract,
    RecordingControl,
    StorageBudget,
} from '../../shared/core/recording-control.ts';
import type { IndexedDbLiquidityArchive } from './indexed-db-liquidity-archive.ts';
import type { IndexedDbService } from './indexed-db-service.ts';
import { STORES } from './browser-schema.ts';

/** Key of the single row holding what this browser chose. */
const CHOICE_KEY = 'choice';

/** Share of the quota a page takes unless the reader says otherwise. */
const DEFAULT_QUOTA_SHARE = 0.25;

/** Bytes one frame costs in the store, measured on a 325-bucket ladder. */
const BYTES_PER_FRAME = 1_300;

/**
 * Contracts one page may record at once.
 *
 * Each is a socket, a mirror of a ladder and a write every second. A server
 * records four of them and is a server; a phone asked for twenty stops being a
 * phone, and the recording it was already making goes down with it.
 */
export const CONTRACTS_PER_PAGE = 6;

interface StoredChoice {
    readonly contracts: readonly RecordedContract[];
    readonly maximumBytes: number | null;
}

export interface BrowserRecordingControlConfig {
    readonly archive: IndexedDbLiquidityArchive;
    readonly database: IndexedDbService;
    readonly estimateStorage: () => Promise<StorageEstimate>;
    /** What a first-time visitor records, and what else they may switch on. */
    readonly catalogue: readonly RecordedContract[];
}

/**
 * Whether two entries name the same contract.
 *
 * By the venue as well as the symbol: two venues both list BTCUSDT, and keyed
 * by the symbol alone switching one off switched off the other's recording.
 */
function isSameContract(one: RecordedContract, other: RecordedContract): boolean {
    return one.venue === other.venue && one.instrumentSymbol === other.instrumentSymbol;
}

/**
 * What this browser records, and how much of its quota it may fill.
 */
export class BrowserRecordingControl implements RecordingControl {
    private readonly config: BrowserRecordingControlConfig;

    constructor(config: BrowserRecordingControlConfig) {
        this.config = config;
    }

    /**
     * Every contract on offer, with what this browser chose for each.
     *
     * @returns The catalogue, with stored choices applied over it.
     */
    async listContracts(): Promise<readonly RecordedContract[]> {
        const stored = (await this.read())?.contracts ?? [];
        const offered = this.config.catalogue.map((one) => {
            const chosen = stored.find((contract) => isSameContract(contract, one));
            return chosen === undefined ? one : { ...one, isEnabled: chosen.isEnabled };
        });

        // What the reader added themselves, after what this build opens with:
        // the catalogue is where a first visit starts, not the whole of what a
        // page may record.
        return [
            ...offered,
            ...stored.filter((contract) => !this.config.catalogue.some(
                (one) => isSameContract(one, contract),
            )),
        ];
    }

    /**
     * Remembers a contract being switched on or off, or one being added.
     *
     * @param contract - The contract and what it should be.
     * @throws Error when the page is already recording as many as it will.
     */
    async saveContract(contract: RecordedContract): Promise<void> {
        const current = await this.listContracts();
        const isKnown = current.some((existing) => isSameContract(existing, contract));
        if (!isKnown && current.length >= CONTRACTS_PER_PAGE) {
            throw new Error(`A page records at most ${String(CONTRACTS_PER_PAGE)} contracts at once.`);
        }

        const kept = isKnown
            ? current.map((existing) => (isSameContract(existing, contract) ? contract : existing))
            : [...current, contract];

        await this.write({
            contracts: kept,
            maximumBytes: (await this.read())?.maximumBytes ?? null,
        });
    }

    /**
     * The ceiling in force, what is stored, and what the browser will allow.
     *
     * @returns All three in bytes.
     */
    async readBudget(): Promise<StorageBudget> {
        const estimate = await this.estimate();
        const quota = estimate.quota ?? null;
        const chosen = (await this.read())?.maximumBytes;

        return {
            maximumBytes: chosen ?? Math.floor((quota ?? 0) * DEFAULT_QUOTA_SHARE),
            usedBytes: estimate.usage ?? 0,
            availableBytes: quota,
        };
    }

    /**
     * Changes how much of the quota the recording may fill.
     *
     * @param maximumBytes - The new ceiling.
     */
    async setBudget(maximumBytes: number): Promise<void> {
        const current = await this.listContracts();
        await this.write({ contracts: current, maximumBytes: Math.max(1, Math.floor(maximumBytes)) });
    }

    /**
     * Drops the oldest frames of every contract until the store fits.
     *
     * @returns How many frames were dropped.
     */
    async pruneToBudget(): Promise<number> {
        const budget = await this.readBudget();
        if (budget.usedBytes <= budget.maximumBytes) {
            return 0;
        }

        const enabled = (await this.listContracts()).filter((contract) => contract.isEnabled);
        if (enabled.length === 0) {
            return 0;
        }

        const framesEach = Math.max(1, Math.floor(budget.maximumBytes / BYTES_PER_FRAME / enabled.length));
        let dropped = 0;
        for (const contract of enabled) {
            dropped += await this.config.archive.pruneToCapacity(contract.instrumentSymbol, framesEach);
        }
        return dropped;
    }

    private async estimate(): Promise<StorageEstimate> {
        try {
            return await this.config.estimateStorage();
        } catch {
            return {};
        }
    }

    private async read(): Promise<StoredChoice | null> {
        try {
            const rows = await this.config.database.readRange<{ key: string; choice: StoredChoice }>(
                STORES.recordingControl,
                IDBKeyRange.only(CHOICE_KEY),
            );
            return rows[0]?.choice ?? null;
        } catch {
            return null;
        }
    }

    private async write(choice: StoredChoice): Promise<void> {
        await this.config.database.transact([STORES.recordingControl], 'readwrite', ([store]) => {
            store!.put({ key: CHOICE_KEY, choice });
        });
    }
}
