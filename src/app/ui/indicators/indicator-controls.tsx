import type { ReactElement } from 'react';
import type { ChartLayout } from '../../painting/render-types.ts';
import { IndicatorLegend } from './indicator-legend.tsx';
import type { IndicatorControls } from '../../react/use-indicators.ts';
import { RemovalNotice } from './removal-notice.tsx';

interface IndicatorOverlayProps {
    readonly controls: IndicatorControls;
    readonly layout: ChartLayout;
    readonly onOpenSettings: (instanceId: string) => void;
}

/**
 * Everything the chart itself says about the indicators on it.
 */
export function IndicatorOverlay({ controls, layout, onOpenSettings }: IndicatorOverlayProps): ReactElement {
    return (
        <>
            <IndicatorLegend controls={controls} layout={layout} onOpenSettings={onOpenSettings} />
            <div className="pointer-events-none absolute bottom-3 left-3">
                <RemovalNotice controls={controls} />
            </div>
        </>
    );
}
