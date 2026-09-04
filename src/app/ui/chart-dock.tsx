import { Code2,
    Coins,
    Layers,
    Lock,
    LockOpen,
    Minus,
    MousePointer2,
    Redo2,
    Rows3,
    Ruler,
    Square,
    TrendingUp,
    Undo2,
} from 'lucide-react';
import type { ComponentType, ReactElement } from 'react';
import type { BarIntervalMs } from '../core/bar-interval.ts';
import {
    CONTROL_ACTIVE_CLASSES,
    CONTROL_BUTTON_CLASSES,
    CONTROL_RESTING_CLASSES,
    CONTROL_BAR_CLASSES,
} from './control-shell.ts';
import { ADDON_EDITOR_ID } from './panel-ids.ts';
import { DockPopover } from './dock-popover.tsx';
import { DRAWING_KINDS, type DrawingKind } from '../../shared/core/drawing.ts';
import type { DrawingControls } from '../react/use-drawings.ts';
import { formatDuration } from '../core/formatting.ts';
import type { IndicatorControls } from '../react/use-indicators.ts';
import { LayerPanel } from './indicators/layer-panel.tsx';
import type { InstrumentCoverage } from '../../shared/core/api-contract.ts';
import { BarIntervalControl, SpanControl } from './time-controls.tsx';
import { ChoiceGrid } from './choice-grid.tsx';
import { PanelSection } from './panel-section.tsx';
import type { TranslationKey } from '../i18n/dictionaries/en.ts';
import { useTranslate } from '../react/use-appearance.ts';

interface ToolFace {
    readonly Icon: ComponentType<{ readonly size?: number }>;
    readonly labelKey: TranslationKey;
}

/** What each tool shows and what it is called, by the kind it draws. */
const TOOL_FACES: Readonly<Record<DrawingKind, ToolFace>> = {
    'horizontal-line': { Icon: Minus, labelKey: 'drawing.horizontalLine' },
    'trend-line': { Icon: TrendingUp, labelKey: 'drawing.trendLine' },
    zone: { Icon: Square, labelKey: 'drawing.zone' },
    fibonacci: { Icon: Rows3, labelKey: 'drawing.fibonacci' },
    measure: { Icon: Ruler, labelKey: 'drawing.measure' },
};

const ICON_SIZE_PX = 18;

/** The base asset, which is what a reader recognises the contract by. */
const QUOTE_SUFFIXES = ['USDT', 'USDC', 'BUSD', 'USD'];

export interface ChartDockProps {
    readonly drawings: DrawingControls;
    /** False where a bar along the top is already asking the chart's questions. */
    readonly hasChartControls?: boolean;
    readonly indicators: IndicatorControls;
    readonly instruments: readonly InstrumentCoverage[];
    readonly instrumentSymbol: string | null;
    readonly onInstrumentSelect: (instrumentSymbol: string) => void;
    readonly time: TimeControls;
    /**
     * Opens the editor, where this build offers one.
     *
     * Optional because the dock is also the phone's whole chrome, and a build
     * that does not carry an editor should not carry a control for it.
     */
    readonly onWriteAReading?: ((key?: string) => void) | undefined;
    readonly isWritingAReading?: boolean | undefined;
}

/** Everything the two time questions need, asked in one place. */
export interface TimeControls {
    readonly visibleSpanMs: number;
    readonly onSpanSelect: (spanMs: number) => void;
    readonly barIntervalMs: BarIntervalMs | null;
    readonly effectiveIntervalMs: number;
    readonly onIntervalSelect: (intervalMs: BarIntervalMs | null) => void;
    /** How wide a drawn column of the book is, or absent when none is drawn. */
    readonly columnSummary?: string;
}

/**
 * Everything the reader reaches for, along the bottom where their thumb is.
 *
 * What used to be a header: the contract, how much time is on screen, and what
 * is drawn over it. Each behind one target that opens above itself, so a phone
 * holds all of it without a bar the reader has to regrip to reach.
 */
export function ChartDock(props: ChartDockProps): ReactElement {
    const translate = useTranslate();
    const { drawings, hasChartControls = true } = props;

    return (
        <div
            className={`${CONTROL_BAR_CLASSES} border-t border-hairline`}
            role="toolbar"
            aria-label={translate('dock.label')}
        >
            {/* Centred by an inner box with margins of its own, rather than by
                justifying the scroller: a centred scroller puts its overflow
                past the left edge, where nothing can scroll back to it. */}
            <div className="m-auto flex items-center gap-2">
                {hasChartControls && (
                    <>
                        <DockPopover
                            label={translate('instrument.label')}
                            trigger={(
                                <span className="flex items-center gap-1 px-1 text-xs font-semibold">
                                    <Coins size={ICON_SIZE_PX} />
                                    {shortenSymbol(props.instrumentSymbol)}
                                </span>
                            )}
                        >
                            {/* No title: the button it opened from is the title, and a panel
                        that repeats it is a line the reader has to read twice. */}
                            <div className="w-56">
                                <ChoiceGrid
                                    isStacked
                                    label={translate('instrument.label')}
                                    value={props.instrumentSymbol ?? ''}
                                    onChoose={props.onInstrumentSelect}
                                    choices={props.instruments.map((instrument) => ({
                                        value: instrument.instrumentSymbol,
                                        label: instrument.instrumentSymbol,
                                    }))}
                                />
                            </div>
                        </DockPopover>

                        <DockPopover
                            label={translate('dock.time')}
                            trigger={(
                                <span className="px-1 text-xs font-semibold">
                                    {formatDuration(props.time.visibleSpanMs, translate)}
                                </span>
                            )}
                        >
                            <TimePanel time={props.time} />
                        </DockPopover>

                        <DockPopover
                            label={translate('indicators.onTheChart')}
                            trigger={<Layers size={ICON_SIZE_PX} />}
                        >
                            <LayerPanel
                                controls={props.indicators}
                                {...props.onWriteAReading === undefined
                                    ? {}
                                    : { onEditReading: props.onWriteAReading }}
                            />
                        </DockPopover>

                        {props.onWriteAReading !== undefined && (
                            <DockButton
                                label={translate('editor.open')}
                                isActive={props.isWritingAReading === true}
                                onPress={() => { props.onWriteAReading?.(); }}
                                reveals={{
                                    id: ADDON_EDITOR_ID,
                                    isOpen: props.isWritingAReading === true,
                                }}
                            >
                                <Code2 size={ICON_SIZE_PX} />
                            </DockButton>
                        )}

                        <Divider />
                    </>
                )}



                <DrawingTools drawings={drawings} />
            </div>
        </div>
    );
}

interface DrawingToolsProps {
    readonly drawings: DrawingControls;
}

/**
 * The pointer and every mark it can be swapped for.
 *
 * Written once because a bar and a dock offer the same four things: the pointer
 * shown as a tool of its own, so the resting state reads as a choice rather
 * than as nothing being on.
 */
export function DrawingTools({ drawings }: DrawingToolsProps): ReactElement {
    const translate = useTranslate();

    return (
        <>
            <DockButton
                label={translate('drawing.select')}
                isActive={drawings.armedTool === null}
                onPress={drawings.disarm}
            >
                <MousePointer2 size={ICON_SIZE_PX} />
            </DockButton>

            {DRAWING_KINDS.map((kind) => {
                const { Icon, labelKey } = TOOL_FACES[kind];
                return (
                    <DockButton
                        key={kind}
                        label={translate(labelKey)}
                        isActive={drawings.armedTool === kind}
                        onPress={() => { drawings.toggleTool(kind); }}
                    >
                        <Icon size={ICON_SIZE_PX} />
                    </DockButton>
                );
            })}

            {/* Beside the tools it pins, because it is about them and nothing
                else: a reader marking six levels should press the chart six
                times, not walk back to the toolbar between each. */}
            <DockButton
                label={translate('drawing.keepTool')}
                isActive={drawings.isToolLocked}
                onPress={drawings.toggleToolLock}
            >
                {drawings.isToolLocked
                    ? <Lock size={ICON_SIZE_PX} />
                    : <LockOpen size={ICON_SIZE_PX} />}
            </DockButton>

            <Divider />

            {/* Beside the tools, because a step back is about what they did. */}
            <DockButton
                label={translate('drawing.undo')}
                isActive={false}
                isDisabled={!drawings.canUndo}
                onPress={drawings.undo}
            >
                <Undo2 size={ICON_SIZE_PX} />
            </DockButton>

            <DockButton
                label={translate('drawing.redo')}
                isActive={false}
                isDisabled={!drawings.canRedo}
                onPress={drawings.redo}
            >
                <Redo2 size={ICON_SIZE_PX} />
            </DockButton>
        </>
    );
}

/**
 * Both time questions, which are one decision asked twice.
 */
function TimePanel({ time }: { readonly time: TimeControls }): ReactElement {
    const translate = useTranslate();

    return (
        <div className="w-60">
            <PanelSection
                isDivided={false}
                title={translate('span.label')}
                {...time.columnSummary === undefined ? {} : { summary: time.columnSummary }}
            >
                <SpanControl
                    activeSpanMs={time.visibleSpanMs}
                    onSelect={time.onSpanSelect}
                />
            </PanelSection>
            <PanelSection isDivided title={translate('interval.label')}>
                <BarIntervalControl
                    barIntervalMs={time.barIntervalMs}
                    effectiveIntervalMs={time.effectiveIntervalMs}
                    onSelect={time.onIntervalSelect}
                />
            </PanelSection>
        </div>
    );
}

/**
 * A hairline between two groups of a dock.
 */
export function Divider(): ReactElement {
    return <span className="h-6 w-px shrink-0 bg-hairline" />;
}

export interface DockButtonProps {
    readonly label: string;
    readonly isActive: boolean;
    readonly onPress: () => void;
    readonly children: ReactElement;
    readonly isDisabled?: boolean;
    /**
     * What it opens, where it opens something.
     *
     * A control that shows a panel is a disclosure, and saying so is the only
     * way a reader who cannot see the colour learns that pressing it did
     * anything at all.
     */
    readonly reveals?: { readonly id: string; readonly isOpen: boolean };
}

/**
 * One control of a dock.
 */
export function DockButton({
    label,
    isActive,
    onPress,
    children,
    isDisabled = false,
    reveals,
}: DockButtonProps): ReactElement {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            {...reveals === undefined
                ? { 'aria-pressed': isActive }
                : { 'aria-expanded': reveals.isOpen, 'aria-controls': reveals.id }}
            disabled={isDisabled}
            onClick={onPress}
            className={`${CONTROL_BUTTON_CLASSES} ${isActive ? CONTROL_ACTIVE_CLASSES : CONTROL_RESTING_CLASSES} disabled:opacity-30`}
        >
            {children}
        </button>
    );
}

/**
 * The contract as a reader names it, which is its base asset.
 *
 * @param instrumentSymbol - The symbol, or null before one is chosen.
 * @returns What the button shows.
 */
function shortenSymbol(instrumentSymbol: string | null): string {
    if (instrumentSymbol === null) {
        return '—';
    }
    const quote = QUOTE_SUFFIXES.find((suffix) => instrumentSymbol.endsWith(suffix));
    return quote === undefined ? instrumentSymbol : instrumentSymbol.slice(0, -quote.length);
}
