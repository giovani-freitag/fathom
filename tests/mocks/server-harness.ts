import type { LiquidityQueryService } from '../../src/database/services/liquidity-query-service.ts';
import type { LiveTailService } from '../../src/server/services/live-tail-service.ts';
import type { PostgresService } from '../../src/database/postgres/postgres-service.ts';
import type { RecordingControlService } from '../../src/database/services/recording-control-service.ts';
import type { ChunkArchiveService } from '../../src/database/services/chunk-archive-service.ts';
import { Server } from '../../src/server/http/server.ts';
import { vi } from 'vitest';

type Spies<TNames extends string> = Readonly<Record<TNames, ReturnType<typeof vi.fn>>>;

export interface ServerHarness {
    readonly server: Server;
    readonly query: Spies<
        'listInstruments' | 'fetchFrameWindow' | 'fetchTradeClusters' | 'fetchGaps' | 'fetchPriceBars'
    >;
    readonly control: Spies<
        'listContracts' | 'readBudget' | 'saveContract' | 'setBudget' | 'pruneToBudget'
    >;
    readonly postgres: Spies<'selectRows'>;
    readonly chunks: Spies<'fetchWindow'>;
}

/**
 * The real gateway over spied services.
 *
 * Injected into rather than listened to, so a route is exercised through the
 * schema that guards it: the one bug this layer has actually had was a field
 * the schema quietly dropped, which no test of the handler alone would see.
 *
 * @param overrides - What the read service should answer with.
 * @returns The server and the spies behind it.
 */
export function createServerHarness(
    overrides: Readonly<Record<string, unknown>> = {},
): ServerHarness {
    const query = {
        listInstruments: vi.fn().mockResolvedValue([]),
        fetchFrameWindow: vi.fn().mockResolvedValue({
            priceBucketSize: 10,
            sampleIntervalMs: 1_000,
            frames: [],
        }),
        fetchTradeClusters: vi.fn().mockResolvedValue({
            priceBucketSize: 10,
            sampleIntervalMs: 1_000,
            clusters: [],
        }),
        fetchGaps: vi.fn().mockResolvedValue([]),
        fetchPriceBars: vi.fn().mockResolvedValue({
            instrumentSymbol: 'BTCUSDT',
            intervalMs: 60_000,
            warmupBarsRequested: 0,
            warmupBarsReturned: 0,
            bars: [],
        }),
    };
    for (const [name, value] of Object.entries(overrides)) {
        query[name as keyof typeof query].mockResolvedValue(value);
    }

    const control = {
        listContracts: vi.fn().mockResolvedValue([]),
        readBudget: vi.fn().mockResolvedValue({
            maximumBytes: 10_737_418_240,
            usedBytes: 0,
            availableBytes: null,
        }),
        saveContract: vi.fn().mockResolvedValue(undefined),
        setBudget: vi.fn().mockResolvedValue(undefined),
        pruneToBudget: vi.fn().mockResolvedValue(0),
    };

    const chunks = { fetchWindow: vi.fn().mockResolvedValue({
        priceBucketSize: 10, sampleIntervalMs: 1_000, frames: [],
    }) };
    const postgres = { selectRows: vi.fn().mockResolvedValue([{ '?column?': 1 }]) };

    const server = new Server({
        host: '127.0.0.1',
        port: 0,
        viewerDistPath: new URL('.', import.meta.url).pathname,
        postgres: postgres as unknown as PostgresService,
        query: query as unknown as LiquidityQueryService,
        chunks: chunks as unknown as ChunkArchiveService,
        liveTail: { start: vi.fn(), stop: vi.fn(), subscribe: vi.fn() } as unknown as LiveTailService,
        control: control as unknown as RecordingControlService,
    });

    return { server, query, control, postgres, chunks };
}
