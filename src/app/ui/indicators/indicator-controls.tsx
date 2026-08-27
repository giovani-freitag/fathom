import type { ReactElement } from 'react';
import type { IndicatorControls } from '../../react/use-indicators.ts';
import { RemovalNotice } from './removal-notice.tsx';

interface IndicatorOverlayProps {
    readonly controls: IndicatorControls;
}

/**
 * What the chart itself says about the layers on it.
 *
 * Only what a reader cannot get back on their own: a layer they have just taken
 * off, while there is still time to change their mind. Everything else a layer
 * is — its name, what it reads, and the four things done to it — lives in one
 * panel in the dock, because that is where a thumb already is.
 */
export function IndicatorOverlay({ controls }: IndicatorOverlayProps): ReactElement {
    return (
        <div className="pointer-events-none absolute bottom-3 left-3">
            <RemovalNotice controls={controls} />
        </div>
    );
}
