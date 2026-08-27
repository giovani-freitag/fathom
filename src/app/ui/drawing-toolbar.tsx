import { Minus, TrendingUp, Trash2 } from 'lucide-react';
import type { ComponentType, ReactElement } from 'react';
import { ControlButton } from './control-button.tsx';
import { DRAWING_KINDS, type DrawingKind } from '../../shared/core/drawing.ts';
import type { DrawingControls } from '../react/use-drawings.ts';
import type { TranslationKey } from '../i18n/dictionaries/en.ts';
import { useTranslate } from '../react/use-appearance.ts';

/** What each tool shows and what it is called, by the kind it draws. */
const TOOL_FACES: Readonly<Record<DrawingKind, {
    readonly Icon: ComponentType<{ readonly size?: number }>;
    readonly labelKey: TranslationKey;
}>> = {
    'horizontal-line': { Icon: Minus, labelKey: 'drawing.horizontalLine' },
    'trend-line': { Icon: TrendingUp, labelKey: 'drawing.trendLine' },
};

const ICON_SIZE_PX = 15;

/** Squared off and tighter than a header control: it sits over the chart. */
const TOOL_BUTTON_CLASSES = '!min-h-9 !min-w-9 !px-0';

interface DrawingToolbarProps {
    readonly controls: DrawingControls;
}

/**
 * The tools a reader marks the chart up with.
 */
export function DrawingToolbar({ controls }: DrawingToolbarProps): ReactElement {
    const translate = useTranslate();

    return (
        <div
            className="pointer-events-auto flex flex-col gap-1"
            role="toolbar"
            aria-label={translate('drawing.toolbar')}
        >
            {DRAWING_KINDS.map((kind) => {
                const { Icon, labelKey } = TOOL_FACES[kind];
                return (
                    <ControlButton
                        key={kind}
                        aria-label={translate(labelKey)}
                        aria-pressed={controls.armedTool === kind}
                        isActive={controls.armedTool === kind}
                        className={TOOL_BUTTON_CLASSES}
                        onClick={() => { controls.toggleTool(kind); }}
                    >
                        <Icon size={ICON_SIZE_PX} />
                    </ControlButton>
                );
            })}

            <ControlButton
                aria-label={translate('drawing.remove')}
                className={TOOL_BUTTON_CLASSES}
                disabled={controls.selectedId === null}
                onClick={controls.removeSelected}
            >
                <Trash2 size={ICON_SIZE_PX} />
            </ControlButton>
        </div>
    );
}
