import { vi } from 'vitest';
import type { DepthDiff, DepthSnapshot } from '../../src/workers/core/depth-types.ts';

/**
 * A ladder spanning 99 to 101.
 *
 * Narrow on purpose, so a merge test can tell a price inside the ladder from
 * one deeper than it ever reached.
 *
 * @param lastUpdateId - The update the ladder is current as of.
 * @returns The snapshot.
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
 * A snapshot source each test tunes for itself.
 *
 * @param lastUpdateId - What the ladder is current as of, where it answers.
 * @returns The double, answering with one snapshot until told otherwise.
 */
export function createSnapshotSource(lastUpdateId = 100): SnapshotSourceMock {
    return {
        fetchDepthSnapshot: vi.fn<() => Promise<DepthSnapshot>>()
            .mockResolvedValue(buildSnapshot(lastUpdateId)),
    };
}
