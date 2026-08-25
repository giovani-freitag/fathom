import { releaseTimerFromEventLoop } from './collector-timers.ts';

/**
 * Waits, without holding the host open.
 *
 * The timer is released so a pending backoff never delays a shutdown that has
 * already closed everything else.
 *
 * @param milliseconds - How long to wait.
 * @returns A promise that settles once the time has passed.
 */
export function delay(milliseconds: number): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<void>();
    releaseTimerFromEventLoop(setTimeout(resolve, milliseconds));
    return promise;
}
