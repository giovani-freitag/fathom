import { X } from 'lucide-react';
import type { ReactElement } from 'react';
import type { DrawingControls } from '../react/use-drawings.ts';
import { DrawingProperties } from './drawing-properties.tsx';
import type { IndicatorControls } from '../react/use-indicators.ts';
import { LayerKnobs } from './indicators/layer-panel.tsx';
import { translateLabel } from '../i18n/translator.ts';
import { findChartLayer } from '../indicators/indicator-catalogue.ts';
import { useTranslate } from '../react/use-appearance.ts';

export interface ChartPropertiesProps {
    readonly drawings: DrawingControls;
    readonly indicators: IndicatorControls;
}

/**
 * Whatever the reader has picked on the chart, open for changing.
 *
 * One slot rather than two, because a reader picks one thing at a time and two
 * panels arguing over the same corner is a layout deciding what they meant. A
 * mark wins while there is one: it is the thing they just pressed.
 */
export function ChartProperties({ drawings, indicators }: ChartPropertiesProps): ReactElement | null {
    const translate = useTranslate();
    if (drawings.selected !== null) {
        return <DrawingProperties controls={drawings} />;
    }

    const picked = indicators.picked;
    const layer = picked === null ? null : findChartLayer(picked.indicatorId);
    if (picked === null || layer === null) {
        return null;
    }

    return (
        <div
            className="pointer-events-auto flex max-h-[70vh] flex-col overflow-y-auto rounded-xl border border-hairline bg-abyss-800/95 p-3 shadow-2xl shadow-black/50 backdrop-blur"
            role="group"
            aria-label={translateLabel(translate, layer.labelKey)}
        >
            <LayerKnobs
                controls={indicators}
                instanceId={picked.instanceId}
                action={(
                    <button
                        type="button"
                        onClick={() => { indicators.pick(null); }}
                        aria-label={translate('indicators.close')}
                        className="-mr-1 grid size-6 shrink-0 place-items-center rounded-md text-ink-500 transition-colors hover:bg-abyss-700 hover:text-ink-100"
                    >
                        <X className="size-4" />
                    </button>
                )}
            />
        </div>
    );
}
