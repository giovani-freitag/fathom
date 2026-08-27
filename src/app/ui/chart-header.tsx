import { BarIntervalControl, SpanControl } from './time-controls.tsx';
import { type ChartDockProps, Divider, DrawingTools } from './chart-dock.tsx';
import { Layers } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { DockPopover } from './dock-popover.tsx';
import { LayerPanel } from './indicators/layer-panel.tsx';
import { Select } from './select.tsx';
import { useIsViewportAtLeast } from '../react/use-viewport-width.ts';
import { useTranslate } from '../react/use-appearance.ts';

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
    // The presets are eight targets in a row; below this there is no room for
    // them beside everything else, and a bar that wraps to two lines has stopped
    // being a bar. Folded, they cost a press and take the width of one control.
    const hasRoomForPresets = useIsViewportAtLeast('xl');

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

            <BarIntervalControl
                isCollapsed
                barIntervalMs={time.barIntervalMs}
                effectiveIntervalMs={time.effectiveIntervalMs}
                frameIntervalMs={time.frameIntervalMs}
                onSelect={time.onIntervalSelect}
            />

            <SpanControl
                isCollapsed={!hasRoomForPresets}
                activeSpanMs={time.visibleSpanMs}
                recordedSpanMs={time.recordedSpanMs}
                onSelect={time.onSpanSelect}
            />

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
