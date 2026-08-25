import type { LiquidityQueryService } from '../../src/database/services/liquidity-query-service.ts';
import { vi } from 'vitest';

export interface LiquidityQueryServiceMock {
    readonly service: LiquidityQueryService;
    readonly fetchFramesAfter: ReturnType<typeof vi.fn>;
    readonly fetchTradeClusters: ReturnType<typeof vi.fn>;
}

/**
 * Every read method as a spy, so a test can both steer the answers and assert
 * the cursor the tail asked with.
 */
export function createLiquidityQueryServiceMock(): LiquidityQueryServiceMock {
    const fetchFramesAfter = vi.fn().mockResolvedValue({
        priceBucketSize: 10,
        sampleIntervalMs: 1_000,
        frames: [],
    });
    const fetchTradeClusters = vi.fn().mockResolvedValue({
        priceBucketSize: 10,
        sampleIntervalMs: 1_000,
        clusters: [],
    });

    return {
        service: {
            fetchFramesAfter,
            fetchTradeClusters,
            listInstruments: vi.fn().mockResolvedValue([]),
            fetchFrameWindow: vi.fn(),
            fetchGaps: vi.fn().mockResolvedValue([]),
        } as unknown as LiquidityQueryService,
        fetchFramesAfter,
        fetchTradeClusters,
    };
}
