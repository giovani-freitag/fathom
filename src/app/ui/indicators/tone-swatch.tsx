import type { PlotTone } from '../../../shared/core/draw-plan.ts';
import type { ReactElement } from 'react';

/**
 * Written out rather than composed, so the class scanner can see every one.
 */
const TONE_CLASSES: Record<PlotTone, string> = {
    phosphor: 'bg-phosphor',
    amber: 'bg-amber',
    violet: 'bg-violet',
    cyan: 'bg-cyan',
    ask: 'bg-ask',
    bid: 'bg-bid',
    ink: 'bg-ink-100',
    muted: 'bg-ink-500',
};

interface ToneSwatchProps {
    readonly tone: PlotTone;
    readonly className?: string;
}

/**
 * The colour one indicator is drawn in, as a mark beside its name.
 */
export function ToneSwatch({ tone, className = '' }: ToneSwatchProps): ReactElement {
    return <span className={`block rounded-full ${TONE_CLASSES[tone]} ${className}`} />;
}

export { TONE_CLASSES };
