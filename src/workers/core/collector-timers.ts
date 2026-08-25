export type TimerHandle = ReturnType<typeof setTimeout>;

/**
 * Stops a pending timer from holding the host open, where the host has that idea.
 *
 * @param handle - Whatever the host's `setTimeout` returned.
 */
export function releaseTimerFromEventLoop(handle: TimerHandle): void {
    // Node keeps its event loop alive for a scheduled timer and a browser has
    // no such notion, so this is feature-detected rather than called.
    const releasable = handle as { unref?: () => void };
    releasable.unref?.();
}
