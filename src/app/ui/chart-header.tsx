import { BarIntervalControl, SpanControl } from './time-controls.tsx';
import { type ChartDockProps, Divider, DrawingTools } from './chart-dock.tsx';
import { Code2, Layers } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { CONTROL_BAR_CLASSES } from './control-shell.ts';
import { DockPopover } from './dock-popover.tsx';
import { ControlButton } from './control-button.tsx';
import { LayerPanel } from './indicators/layer-panel.tsx';
import { Select } from './select.tsx';
import { useTranslate } from '../react/use-appearance.ts';

const ICON_SIZE_PX = 18;

export interface ChartHeaderProps extends ChartDockProps {
    /** The drawer trigger, which the page owns because it owns the drawer. */
    readonly settings: ReactNode;
    /**
     * Whether the bar can lay the span presets out rather than fold them.
     *
     * Handed down rather than read here: the page is where the room is measured
     * for every layout that answers to it, and a component that asks the window
     * about itself is one that cannot be drawn twice at two widths.
     */
    readonly hasRoomForPresets: boolean;
    /** Opens the editor beside the chart. */
    readonly onWriteAReading: () => void;
    readonly isWritingAReading: boolean;
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
        <header className={`${CONTROL_BAR_CLASSES} border-b border-hairline`}>
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
                onSelect={time.onIntervalSelect}
            />

            <SpanControl
                isCollapsed={!props.hasRoomForPresets}
                activeSpanMs={time.visibleSpanMs}
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

            <ControlButton
                aria-label={translate('editor.open')}
                title={translate('editor.open')}
                onClick={props.onWriteAReading}
                isActive={props.isWritingAReading}
            >
                <Code2 size={ICON_SIZE_PX} />
            </ControlButton>

            {props.settings}
        </header>
    );
}
