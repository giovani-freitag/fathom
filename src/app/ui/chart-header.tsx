import { Layers } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { BAR_INTERVALS_MS, type BarIntervalMs } from '../core/bar-interval.ts';
import { type ChartDockProps, Divider, DrawingTools, type TimeControls } from './chart-dock.tsx';
import { DockPopover } from './dock-popover.tsx';
import { formatDuration } from '../core/formatting.ts';
import { LayerPanel } from './indicators/layer-panel.tsx';
import { Select } from './select.tsx';
import { SpanPresets } from './span-presets.tsx';
import { useTranslate } from '../react/use-appearance.ts';

/** The value the interval choices carry while the window is deciding for itself. */
const AUTOMATIC_INTERVAL = 'auto';

const ICON_SIZE_PX = 18;

export interface ChartHeaderProps extends ChartDockProps {
    /** The drawer trigger, which the page owns because it owns the drawer. */
    readonly settings: ReactNode;
}

/**
 * The chart's questions, asked out loud along the top.
 *
 * Only where there is room for them. On a screen held in one hand the same
 * questions live behind targets near the thumb, because a bar up here is one a
 * reader has to regrip to reach; on a screen with a mouse and a metre of width,
 * hiding them costs a click and buys nothing.
 *
 * A dropdown is the right shape here for the same reason it was the wrong one
 * down there: it is the only thing being opened, rather than a second menu
 * inside a panel that already opened.
 */
export function ChartHeader(props: ChartHeaderProps): ReactElement {
    const translate = useTranslate();
    const { time } = props;

    return (
        <header className="flex shrink-0 items-center gap-2 border-b border-hairline px-3 py-2">
            <Select
                value={props.instrumentSymbol ?? ''}
                label={translate('instrument.label')}
                onSelect={props.onInstrumentSelect}
                choices={props.instruments.map((instrument) => ({
                    value: instrument.instrumentSymbol,
                    label: instrument.instrumentSymbol,
                }))}
            />

            <Select
                value={time.barIntervalMs === null ? AUTOMATIC_INTERVAL : String(time.barIntervalMs)}
                label={translate('interval.label')}
                onSelect={(value) => {
                    time.onIntervalSelect(
                        value === AUTOMATIC_INTERVAL ? null : (Number(value) as BarIntervalMs),
                    );
                }}
                choices={[
                    {
                        value: AUTOMATIC_INTERVAL,
                        label: translate('interval.auto', {
                            interval: formatDuration(time.effectiveIntervalMs, translate),
                        }),
                    },
                    ...BAR_INTERVALS_MS
                        .filter((rung) => rung >= Math.max(1, time.frameIntervalMs))
                        .map((rung) => ({ value: String(rung), label: formatDuration(rung, translate) })),
                ]}
            />

            <SpanRow time={time} />

            <Divider />

            {/* Up here too on a wide screen: with a bar there is no reason to
                leave them floating over the chart the way a phone must. */}
            <DrawingTools drawings={props.drawings} />

            <span className="flex-1" />

            <DockPopover
                side="bottom"
                label={translate('indicators.onTheChart')}
                trigger={<Layers size={ICON_SIZE_PX} />}
            >
                <LayerPanel controls={props.indicators} />
            </DockPopover>

            {props.settings}
        </header>
    );
}

/**
 * The spans, laid along the bar rather than folded into a panel.
 */
function SpanRow({ time }: { readonly time: TimeControls }): ReactElement {
    return (
        <div className="min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <SpanPresets
                activeSpanMs={time.visibleSpanMs}
                recordedSpanMs={time.recordedSpanMs}
                onSelect={time.onSpanSelect}
            />
        </div>
    );
}
