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

/**
 * Waits, without holding the host open.
 *
 * @param milliseconds - How long to wait.
 * @returns A promise that settles once the time has passed.
 */
export function delay(milliseconds: number): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<void>();
    releaseTimerFromEventLoop(setTimeout(resolve, milliseconds));
    return promise;
}
