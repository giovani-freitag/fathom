import type {
    RecordedContract,
    RecordingControl,
    StorageBudget,
} from '../../shared/core/recording-control.ts';
import type { IndexedDbLiquidityArchive } from './indexed-db-liquidity-archive.ts';
import type { IndexedDbService } from './indexed-db-service.ts';
import { STORES } from './browser-schema.ts';
import { FIRST_VENUE, MINIMUM_BUDGET_BYTES } from '../../shared/core/recording-control.ts';

/** Key of the single row holding what this browser chose. */
const CHOICE_KEY = 'choice';

/** Share of the quota a page takes unless the reader says otherwise. */
const DEFAULT_QUOTA_SHARE = 0.25;

/** Bytes one frame costs in the store, measured on a 325-bucket ladder. */
const BYTES_PER_FRAME = 1_300;

/** A contract by name alone, which is all a refusal has to remember. */
interface ContractName {
    readonly venue: string;
    readonly instrumentSymbol: string;
}

interface StoredChoice {
    readonly contracts: readonly RecordedContract[];
    readonly maximumBytes: number | null;
    /**
     * Pairs the reader deleted, which are not offered again.
     *
     * The catalogue is both what a first visit opens with and what else may
     * be switched on, so it is merged into every listing. Taken out of the
     * stored choice alone, a pair the reader deleted came back from the
     * catalogue on the very next read — the row still on screen, its
     * recording already gone. Absent on a choice written before this, which
     * is a reader who has refused nothing.
     */
    readonly dismissed?: readonly ContractName[];
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
function isSameContract(one: ContractName, other: ContractName): boolean {
    return one.venue === other.venue && one.instrumentSymbol === other.instrumentSymbol;
}

/**
 * A contract as this row may hold one, rather than as everything reads one.
 *
 * The venue is optional here and nowhere else. This row is not one of the
 * stores the venue re-key rebuilt, so a reader who had chosen anything before
 * it carries contracts naming only a symbol, and a type claiming otherwise
 * would be asserting something about bytes on their disk that nothing wrote.
 */
type StoredContract = Omit<RecordedContract, 'venue'> & { readonly venue?: string };

/** The row as it comes off the disk, before anything is assumed about it. */
interface StoredRow {
    readonly contracts: readonly StoredContract[];
    readonly maximumBytes: number | null;
    readonly dismissed?: readonly ContractName[];
}

/**
 * The stored choice with a venue named on every contract in it.
 *
 * Matched against a catalogue that names both venue and symbol, a contract
 * naming only a symbol was recognised as none of them: every catalogue pair
 * was listed twice — once from the catalogue, once as a pair the reader had
 * added — and a page offering five showed ten, then refused to record anything
 * more for being over the limit it counts against.
 *
 * @param row - What was stored, in whatever shape it was written.
 * @returns The same choice, keyed the way everything reads it now.
 */
function withVenuesNamed(row: StoredRow): StoredChoice {
    return {
        ...row,
        contracts: row.contracts.map((one) => ({ ...one, venue: one.venue ?? FIRST_VENUE })),
    };
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
        const choice = await this.read();
        const stored = choice?.contracts ?? [];
        const refused = choice?.dismissed ?? [];
        const offered = this.config.catalogue
            .filter((one) => !refused.some((gone) => isSameContract(gone, one)))
            .map((one) => {
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
        const kept = isKnown
            ? current.map((existing) => (isSameContract(existing, contract) ? contract : existing))
            : [...current, contract];

        const choice = await this.read();
        await this.write({
            contracts: kept,
            maximumBytes: choice?.maximumBytes ?? null,
            // Asked for again is no longer refused, so the catalogue may
            // offer it once more if the reader deletes what they just added.
            dismissed: (choice?.dismissed ?? []).filter((gone) => !isSameContract(gone, contract)),
        });
    }

    /**
     * Takes a contract off the list and deletes what it recorded.
     *
     * Everything keyed by that symbol, across every store the collector writes
     * to. The choice goes last: while it is stored the collector may still pick
     * the contract up, and a delete that ran before it let go would be emptying
     * a store still being written into.
     *
     * @param venue - Which connector the symbol belongs to.
     * @param instrumentSymbol - Which contract.
     */
    async removeContract(venue: string, instrumentSymbol: string): Promise<void> {
        const gone = { venue, instrumentSymbol };
        const kept = (await this.listContracts())
            .filter((contract) => !isSameContract(contract, gone));
        const choice = await this.read();
        const refused = choice?.dismissed ?? [];
        await this.write({
            contracts: kept,
            maximumBytes: choice?.maximumBytes ?? null,
            dismissed: refused.some((one) => isSameContract(one, gone))
                ? refused
                : [...refused, gone],
        });

        // Every store the recording touches, by the pair they all key on.
        // Bounded by the symbol alone, taking one exchange's BTCUSDT away
        // would take every exchange's recording of it.
        const named = IDBKeyRange.only([venue, instrumentSymbol]);
        const under = IDBKeyRange.bound(
            [venue, instrumentSymbol],
            [venue, instrumentSymbol, []],
        );
        await this.config.database.transact([
            STORES.instrumentRegistry,
            STORES.tradeCluster,
            STORES.recordingGap,
            STORES.liquidityBlock,
            STORES.liquidityChunk,
        ], 'readwrite', ([registry, trades, gaps, blocks, chunks]) => {
            registry!.delete(named);
            for (const store of [trades!, gaps!, blocks!, chunks!]) {
                store.delete(under);
            }
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
        await this.write({
            contracts: current,
            maximumBytes: Math.max(MINIMUM_BUDGET_BYTES, Math.floor(maximumBytes)),
            dismissed: (await this.read())?.dismissed ?? [],
        });
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
            dropped += await this.config.archive.pruneToCapacity(contract, framesEach);
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
            const rows = await this.config.database.readRange<{ key: string; choice: StoredRow }>(
                STORES.recordingControl,
                IDBKeyRange.only(CHOICE_KEY),
            );
            const choice = rows[0]?.choice;
            return choice === undefined ? null : withVenuesNamed(choice);
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
