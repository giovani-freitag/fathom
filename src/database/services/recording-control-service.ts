import type { PostgresService } from '../postgres/postgres-service.ts';
import type {
    RecordedContract,
    RecordingControl,
    StorageBudget,
} from '../../shared/core/recording-control.ts';

export interface RecordingControlServiceConfig {
    readonly postgres: PostgresService;
}

export type { RecordedContract as EnabledInstrument, StorageBudget as BudgetReading };

interface InstrumentRow {
    readonly instrument_symbol: string;
    readonly price_bucket_size: number;
    readonly frame_interval_ms: number;
    readonly is_enabled: boolean;
}

interface BudgetRow {
    readonly maximum_bytes: string;
    readonly used_bytes: string;
}

interface OldestChunkRow {
    readonly range_end: Date;
}

/**
 * What is being recorded, and how much of the disk it may have.
 */
export class RecordingControlService implements RecordingControl {
    private readonly postgres: PostgresService;

    constructor(config: RecordingControlServiceConfig) {
        this.postgres = config.postgres;
    }

    /**
     * Every registered contract, enabled or not.
     *
     * @returns The contracts, ordered by symbol.
     * @throws PostgresQueryError when the read fails.
     */
    async listContracts(): Promise<RecordedContract[]> {
        const rows = await this.postgres.selectRows<InstrumentRow>(
            `SELECT instrument_symbol, price_bucket_size, frame_interval_ms, is_enabled
             FROM instrument_registry
             ORDER BY instrument_symbol`,
        );

        return rows.map((row) => ({
            instrumentSymbol: row.instrument_symbol,
            priceBucketSize: row.price_bucket_size,
            frameIntervalMs: row.frame_interval_ms,
            isEnabled: row.is_enabled,
        }));
    }

    /**
     * Registers a contract to record, or changes the grid of one already known.
     *
     * @param instrument - The contract and its grid.
     * @throws PostgresQueryError when the write fails.
     */
    async saveContract(instrument: RecordedContract): Promise<void> {
        await this.postgres.execute(
            `INSERT INTO instrument_registry
                 (instrument_symbol, price_bucket_size, frame_interval_ms, is_enabled)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (instrument_symbol) DO UPDATE
                 SET price_bucket_size = EXCLUDED.price_bucket_size,
                     frame_interval_ms = EXCLUDED.frame_interval_ms,
                     is_enabled        = EXCLUDED.is_enabled`,
            [
                instrument.instrumentSymbol,
                instrument.priceBucketSize,
                instrument.frameIntervalMs,
                instrument.isEnabled,
            ],
        );
    }

    /**
     * Turns recording of one contract on or off.
     *
     * @param instrumentSymbol - Which contract.
     * @param isEnabled - Whether a supervisor should be recording it.
     * @throws PostgresQueryError when the write fails.
     */
    async setEnabled(instrumentSymbol: string, isEnabled: boolean): Promise<void> {
        await this.postgres.execute(
            'UPDATE instrument_registry SET is_enabled = $2 WHERE instrument_symbol = $1',
            [instrumentSymbol, isEnabled],
        );
    }

    /**
     * The disk budget and what the recording currently occupies.
     *
     * @returns Both figures in bytes.
     * @throws PostgresQueryError when the read fails.
     */
    async readBudget(): Promise<StorageBudget> {
        const rows = await this.postgres.selectRows<BudgetRow>(
            `SELECT maximum_bytes::text,
                    (hypertable_size('liquidity_frame')
                     + hypertable_size('trade_cluster'))::text AS used_bytes
             FROM recording_budget`,
        );
        const row = rows[0];

        return {
            maximumBytes: Number(row?.maximum_bytes ?? 0),
            usedBytes: Number(row?.used_bytes ?? 0),
            // The database sits on a volume this process cannot measure from
            // inside a query, so the ceiling is the reader's to judge.
            availableBytes: null,
        };
    }

    /**
     * Changes how much disk the recording may take.
     *
     * @param maximumBytes - The new ceiling.
     * @throws PostgresQueryError when the write fails.
     */
    async setBudget(maximumBytes: number): Promise<void> {
        await this.postgres.execute(
            'UPDATE recording_budget SET maximum_bytes = $1, updated_at = now()',
            [Math.max(1, Math.floor(maximumBytes))],
        );
    }

    /**
     * Drops the oldest partitions until the recording fits its budget.
     *
     * @returns How many partitions were dropped.
     * @throws PostgresQueryError when a drop fails.
     */
    async pruneToBudget(): Promise<number> {
        let dropped = 0;

        for (;;) {
            const budget = await this.readBudget();
            if (budget.usedBytes <= budget.maximumBytes) {
                return dropped;
            }

            const boundary = await this.findOldestChunkEnd();
            if (boundary === null) {
                return dropped;
            }

            await this.postgres.execute(
                `SELECT drop_chunks('liquidity_frame', older_than => $1::timestamptz),
                        drop_chunks('trade_cluster',   older_than => $1::timestamptz)`,
                [boundary],
            );
            dropped += 1;
        }
    }

    /**
     * Where the oldest partition ends, which is the only boundary a drop accepts.
     */
    private async findOldestChunkEnd(): Promise<Date | null> {
        const rows = await this.postgres.selectRows<OldestChunkRow>(
            `SELECT range_end
             FROM timescaledb_information.chunks
             WHERE hypertable_name = 'liquidity_frame'
             ORDER BY range_start ASC
             LIMIT 1`,
        );
        return rows[0]?.range_end ?? null;
    }
}
