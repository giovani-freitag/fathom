import { ControlButton } from './control-button.tsx';
import { SPAN_PRESETS } from './span-preset-catalogue.ts';
import type { ReactElement } from 'react';
import { useTranslate } from '../react/use-appearance.ts';

interface SpanPresetsProps {
    readonly activeSpanMs: number;
    readonly recordedSpanMs: number;
    readonly onSelect: (spanMs: number) => void;
}

/**
 * Jumps the time axis to a fixed span ending at the live edge.
 */
export function SpanPresets({ activeSpanMs, recordedSpanMs, onSelect }: SpanPresetsProps): ReactElement {
    const translate = useTranslate();

    return (
        <div
            className="flex items-center gap-1.5 overflow-x-auto px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            role="group"
            aria-label={translate('span.label')}
        >
            {SPAN_PRESETS.map((preset) => {
                const isBeyondCoverage = preset.spanMs > recordedSpanMs * 1.2;
                return (
                    <ControlButton
                        key={preset.label}
                        isActive={Math.abs(activeSpanMs - preset.spanMs) < preset.spanMs * 0.12}
                        disabled={isBeyondCoverage}
                        title={isBeyondCoverage ? translate('span.beyondCoverage') : undefined}
                        onClick={() => { onSelect(preset.spanMs); }}
                        className="shrink-0 px-3.5"
                    >
                        {preset.label}
                    </ControlButton>
                );
            })}
        </div>
    );
}
