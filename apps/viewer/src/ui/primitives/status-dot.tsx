import type { ReactElement } from 'react';

export type StatusTone = 'live' | 'pending' | 'stale' | 'idle';

interface StatusDotProps {
    readonly tone: StatusTone;
}

const TONE_CLASSES: Record<StatusTone, string> = {
    live: 'bg-phosphor shadow-[0_0_8px_var(--color-phosphor)]',
    pending: 'bg-amber animate-pulse',
    stale: 'bg-ask',
    idle: 'bg-ink-700',
};

/**
 * A one-glance indicator of whether the chart is still being fed.
 */
export function StatusDot({ tone }: StatusDotProps): ReactElement {
    return <span aria-hidden className={`inline-block size-2 rounded-full ${TONE_CLASSES[tone]}`} />;
}
