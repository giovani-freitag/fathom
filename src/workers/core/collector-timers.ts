export type TimerHandle = ReturnType<typeof setTimeout>;

/**
 * Stops a pending timer from holding the host open, where the host has that idea.
 *
 * Node keeps its event loop alive for a scheduled timer, so a collector that
 * never releases one never exits. A browser has no such notion and hands back a
 * plain number. Feature-detecting keeps the shutdown behaviour on the runtime
 * that needs it without the other throwing on a method it does not have.
 *
 * @param handle - Whatever the host's `setTimeout` returned.
 */
export function releaseTimerFromEventLoop(handle: TimerHandle): void {
    const releasable = handle as { unref?: () => void };
    releasable.unref?.();
}
