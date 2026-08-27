import { ControlButton } from './control-button.tsx';
import { SPAN_PRESETS } from './span-preset-catalogue.ts';
import { memo, type ReactElement } from 'react';
import { useTranslate } from '../react/use-appearance.ts';

interface SpanPresetsProps {
    readonly activeSpanMs: number;
    readonly recordedSpanMs: number;
    readonly onSelect: (spanMs: number) => void;
}

/**
 * Jumps the time axis to a fixed span ending at the live edge.
 *
 * Wrapped rather than scrolled: it is read inside a panel that opens to fit it,
 * and a row a reader has to drag sideways hides half the choices it offers.
 */
function SpanPresetsComponent({ activeSpanMs, recordedSpanMs, onSelect }: SpanPresetsProps): ReactElement {
    const translate = useTranslate();

    return (
        <div
            className="flex flex-wrap items-center gap-1.5"
            role="group"
            aria-label={translate('span.label')}
        >
            {SPAN_PRESETS.map((preset) => {
                const isBeyondCoverage = preset.spanMs > recordedSpanMs * 1.2;
                return (
                    <ControlButton
                        key={preset.labelKey}
                        isActive={Math.abs(activeSpanMs - preset.spanMs) < preset.spanMs * 0.12}
                        disabled={isBeyondCoverage}
                        title={isBeyondCoverage ? translate('span.beyondCoverage') : undefined}
                        onClick={() => { onSelect(preset.spanMs); }}
                        className="shrink-0 px-3.5"
                    >
                        {translate(preset.labelKey)}
                    </ControlButton>
                );
            })}
        </div>
    );
}

/**
 * Re-rendered only when the span it marks changes.
 *
 * A pan leaves the span alone, so following the viewport from here rebuilt a
 * row of buttons on every frame of one.
 */
export const SpanPresets = memo(SpanPresetsComponent);
