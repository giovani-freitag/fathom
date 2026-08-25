import { vi } from 'vitest';
import type { DepthDiff, DepthSnapshot } from '../../src/book/depth-types.ts';

/**
 * A ladder whose span covers 99 to 101, so a merge test can tell "inside the
 * ladder" from "deeper than the ladder ever reached".
 */
export function buildSnapshot(lastUpdateId: number): DepthSnapshot {
    return {
        lastUpdateId,
        bidLevels: [['100', '5'], ['99', '4']],
        askLevels: [['101', '6']],
    };
}

export function buildDiff(overrides: Partial<DepthDiff> = {}): DepthDiff {
    return {
        firstUpdateId: 100,
        finalUpdateId: 110,
        previousFinalUpdateId: 99,
        bidLevels: [],
        askLevels: [],
        ...overrides,
    };
}

export interface SnapshotSourceMock {
    readonly fetchDepthSnapshot: ReturnType<typeof vi.fn<() => Promise<DepthSnapshot>>>;
}

/**
 * A snapshot source whose answers each test tunes, so one shared shape covers
 * the happy path, the stale ladder, and the failing endpoint.
 */
export function createSnapshotSource(lastUpdateId = 100): SnapshotSourceMock {
    return {
        fetchDepthSnapshot: vi.fn<() => Promise<DepthSnapshot>>()
            .mockResolvedValue(buildSnapshot(lastUpdateId)),
    };
}
