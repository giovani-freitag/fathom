import { ChartSpline, Coins, Layers, Minus, MousePointer2, Square, TrendingUp } from 'lucide-react';
import { type ComponentType, type ReactElement, useCallback, useEffect, useState } from 'react';
import { BAR_INTERVALS_MS, type BarIntervalMs } from '../core/bar-interval.ts';
import {
    DOCK_ACTIVE_CLASSES,
    DOCK_BUTTON_CLASSES,
    DOCK_RESTING_CLASSES,
    DockPopover,
    FLOATING_PANEL_CLASSES,
} from './dock-popover.tsx';
import { DRAWING_KINDS, type DrawingKind } from '../../shared/core/drawing.ts';
import type { DrawingControls } from '../react/use-drawings.ts';
import { formatDuration } from '../core/formatting.ts';
import type { IndicatorControls } from '../react/use-indicators.ts';
import { IndicatorPalette } from './indicators/indicator-palette.tsx';
import { LayerList } from './indicators/layer-list.tsx';
import type { InstrumentCoverage } from '../../shared/core/api-contract.ts';
import { ChoiceGrid } from './choice-grid.tsx';
import { PanelSection } from './panel-section.tsx';
import { SpanPresets } from './span-presets.tsx';
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
};

const ICON_SIZE_PX = 18;

/** The value the interval choices carry while the window is deciding for itself. */
const AUTOMATIC_INTERVAL = 'auto';

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
    /** Opens the drawer onto one layer, which the page owns because it owns it. */
    readonly onOpenLayerSettings: (instanceId: string) => void;
}

/** Everything the two time questions need, asked in one place. */
export interface TimeControls {
    readonly visibleSpanMs: number;
    readonly recordedSpanMs: number;
    readonly onSpanSelect: (spanMs: number) => void;
    readonly barIntervalMs: BarIntervalMs | null;
    readonly effectiveIntervalMs: number;
    readonly frameIntervalMs: number;
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
    const [isPaletteOpen, setIsPaletteOpen] = useState(false);
    const openPalette = useCallback(() => { setIsPaletteOpen(true); }, []);

    useOpenShortcut(openPalette);

    return (
        <div
            className={`${FLOATING_PANEL_CLASSES} max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`}
            role="toolbar"
            aria-label={translate('dock.label')}
        >
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
                        label={translate('indicators.open')}
                        title={translate('indicators.openWith', { shortcut: readShortcutLabel() })}
                        isOpen={isPaletteOpen}
                        onOpenChange={setIsPaletteOpen}
                        trigger={<ChartSpline size={ICON_SIZE_PX} />}
                    >
                        <IndicatorPalette
                            onAdd={props.indicators.add}
                            isFull={props.indicators.isFull}
                            addedCounts={props.indicators.addedCounts}
                            hasAutoFocus
                        />
                    </DockPopover>

                    <DockPopover
                        label={translate('indicators.onTheChart')}
                        trigger={<Layers size={ICON_SIZE_PX} />}
                    >
                        {/* Wide enough for a reading: a row that truncates its own
                        figures is a row that has to be opened somewhere else. */}
                        <div className="w-[min(21rem,calc(100vw-3rem))]">
                            <LayerList controls={props.indicators} onOpenSettings={props.onOpenLayerSettings} />
                        </div>
                    </DockPopover>

                    <Divider />
                </>
            )}



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
        </div>
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
                <SpanPresets
                    activeSpanMs={time.visibleSpanMs}
                    recordedSpanMs={time.recordedSpanMs}
                    onSelect={time.onSpanSelect}
                />
            </PanelSection>
            <PanelSection isDivided title={translate('interval.label')}>
                <ChoiceGrid
                    label={translate('interval.label')}
                    value={time.barIntervalMs === null ? AUTOMATIC_INTERVAL : String(time.barIntervalMs)}
                    onChoose={(value) => {
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
                            .map((rung) => ({
                                value: String(rung),
                                label: formatDuration(rung, translate),
                            })),
                    ]}
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
}: DockButtonProps): ReactElement {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            aria-pressed={isActive}
            disabled={isDisabled}
            onClick={onPress}
            className={`${DOCK_BUTTON_CLASSES} ${isActive ? DOCK_ACTIVE_CLASSES : DOCK_RESTING_CLASSES} disabled:opacity-30`}
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

/**
 * The chord this platform's readers reach for to open a palette.
 */
function readShortcutLabel(): string {
    const isApple = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
    return isApple ? '⌘K' : 'Ctrl K';
}

/**
 * Opens the catalogue on the chord a reader expects a palette to answer.
 */
function useOpenShortcut(onOpen: () => void): void {
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent): void => {
            if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                onOpen();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => { window.removeEventListener('keydown', handleKeyDown); };
    }, [onOpen]);
}
