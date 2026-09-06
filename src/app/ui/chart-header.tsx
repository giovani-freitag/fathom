import { BarIntervalControl, SpanControl } from './time-controls.tsx';
import { type ChartDockProps, DockButton, Divider, DrawingTools } from './chart-dock.tsx';
import { ADDON_EDITOR_ID } from './panel-ids.ts';
import { Code2, Layers } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { CONTROL_BAR_CLASSES } from './control-shell.ts';
import { DockPopover } from './dock-popover.tsx';
import { LayerPanel } from './indicators/layer-panel.tsx';
import { MarketsButton } from './markets/markets-button.tsx';
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
    /** Opens the editor beside the chart, on a saved reading where named. */
    readonly onWriteAReading: (key?: string) => void;
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
            {/* The same panel the dock opens, rather than a dropdown of the
                recorded contracts: a reader keeping a pair and a reader opening
                one are asking the same question, and answering it in two places
                meant finding out that they were different places. */}
            <MarketsButton
                side="bottom"
                iconSizePx={ICON_SIZE_PX}
                said={props.instrumentSymbol ?? ''}
                openPair={props.openPair}
                onPairOpen={props.onPairOpen}
                onWriteAConnector={props.onWriteAConnector}
            />

            {/* Given a width rather than left to take one. A dropdown fills
                the box it is put in, which is what the panels want and what a
                bar cannot afford: as a bare item in this row it grew to five
                hundred and fifty pixels, squeezed the presets beside it until
                they wrapped, and left the header three rows deep over the
                chart. */}
            <div className="w-36 shrink-0">
                <BarIntervalControl
                    isCollapsed
                    barIntervalMs={time.barIntervalMs}
                    effectiveIntervalMs={time.effectiveIntervalMs}
                    onSelect={time.onIntervalSelect}
                />
            </div>

            {/* Held at the width of its own chips: squeezed, they wrap, and a
                bar that scrolls sideways has no use for a second line. */}
            <div className="shrink-0">
                <SpanControl
                    isCollapsed={!props.hasRoomForPresets}
                    activeSpanMs={time.visibleSpanMs}
                    onSelect={time.onSpanSelect}
                />
            </div>

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
                <LayerPanel controls={props.indicators} onEditReading={props.onWriteAReading} />
            </DockPopover>

            {/* The dock's own shape, like its two neighbours: a bordered chip
                among two bare glyphs read as a control from another bar. It is
                a disclosure, so it says so rather than only looking pressed. */}
            <DockButton
                label={translate('editor.open')}
                isActive={props.isWritingAReading}
                onPress={() => { props.onWriteAReading(); }}
                reveals={{ id: ADDON_EDITOR_ID, isOpen: props.isWritingAReading }}
            >
                <Code2 size={ICON_SIZE_PX} />
            </DockButton>

            {props.settings}
        </header>
    );
}
