import { type Mock, vi } from 'vitest';
import type { LiquidityArchive } from '../../src/database/services/liquidity-archive.ts';

export type MockLiquidityArchive = {
    readonly [Method in keyof LiquidityArchive]: Mock<LiquidityArchive[Method]>;
};

/**
 * An archive that accepts everything, until a test says otherwise.
 *
 * @returns A fresh archive whose every method records what it was called with.
 */
export function createMockLiquidityArchive(): MockLiquidityArchive {
    return {
        open: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        registerInstrument: vi.fn().mockResolvedValue(undefined),
        appendTradeClusters: vi.fn().mockResolvedValue(undefined),
        recordGap: vi.fn().mockResolvedValue(undefined),
        findLastFrameTimestamp: vi.fn().mockResolvedValue(null),
    };
}
