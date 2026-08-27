import { MousePointer2, Minus, Square, Trash2, TrendingUp } from 'lucide-react';
import type { ComponentType, ReactElement } from 'react';
import { DRAWING_KINDS, type DrawingKind } from '../../shared/core/drawing.ts';
import type { DrawingControls } from '../react/use-drawings.ts';
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

/**
 * One tap target, sized for a thumb rather than a cursor.
 *
 * Every control in the dock is this size, because the row is reached blind at
 * the bottom of a phone and a target that varies is a target that gets missed.
 */
const DOCK_BUTTON_CLASSES = 'grid size-11 shrink-0 place-items-center rounded-lg transition-colors';

/** The shell the dock and the strip above it share, so they read as one thing. */
export const FLOATING_PANEL_CLASSES =
    'pointer-events-auto flex items-center gap-1 rounded-2xl border border-hairline'
    + ' bg-abyss-800/95 px-1.5 py-1 shadow-lg backdrop-blur';

const ACTIVE_CLASSES = 'bg-phosphor/15 text-phosphor';
const RESTING_CLASSES = 'text-ink-400 hover:bg-abyss-700 hover:text-ink-100';

interface DrawingDockProps {
    readonly controls: DrawingControls;
}

/**
 * The drawing tools, along the bottom where a thumb already is.
 */
export function DrawingDock({ controls }: DrawingDockProps): ReactElement {
    const translate = useTranslate();

    return (
        <div
            className={FLOATING_PANEL_CLASSES}
            role="toolbar"
            aria-label={translate('drawing.toolbar')}
        >
            <DockButton
                label={translate('drawing.select')}
                isActive={controls.armedTool === null}
                onPress={controls.disarm}
            >
                <MousePointer2 size={ICON_SIZE_PX} />
            </DockButton>

            <Divider />

            {DRAWING_KINDS.map((kind) => {
                const { Icon, labelKey } = TOOL_FACES[kind];
                return (
                    <DockButton
                        key={kind}
                        label={translate(labelKey)}
                        isActive={controls.armedTool === kind}
                        onPress={() => { controls.toggleTool(kind); }}
                    >
                        <Icon size={ICON_SIZE_PX} />
                    </DockButton>
                );
            })}

            <Divider />

            <DockButton
                label={translate('drawing.remove')}
                isActive={false}
                isDisabled={controls.selectedId === null}
                onPress={controls.removeSelected}
            >
                <Trash2 size={ICON_SIZE_PX} />
            </DockButton>
        </div>
    );
}

/**
 * A hairline between two groups of the dock.
 */
function Divider(): ReactElement {
    return <span className="h-6 w-px shrink-0 bg-hairline" />;
}

interface DockButtonProps {
    readonly label: string;
    readonly isActive: boolean;
    readonly onPress: () => void;
    readonly children: ReactElement;
    readonly isDisabled?: boolean;
}

/**
 * One control of the dock.
 */
function DockButton({
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
            className={`${DOCK_BUTTON_CLASSES} ${isActive ? ACTIVE_CLASSES : RESTING_CLASSES} disabled:opacity-30`}
        >
            {children}
        </button>
    );
}
