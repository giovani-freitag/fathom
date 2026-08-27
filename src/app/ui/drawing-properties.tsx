import { Trash2 } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import {
    type Drawing,
    DRAWING_STYLES,
    DRAWING_WIDTHS,
    type DrawingStyle,
    type DrawingWidth,
    resolveDrawingLook,
} from '../../shared/core/drawing.ts';
import type { DrawingControls } from '../react/use-drawings.ts';
import { INSTANCE_TONES, type PlotTone } from '../../shared/core/draw-plan.ts';
import { useTranslate } from '../react/use-appearance.ts';

/** The class each tone's swatch is filled with, so the canvas and the page agree. */
const TONE_SWATCHES: Readonly<Record<PlotTone, string>> = {
    phosphor: 'bg-phosphor',
    amber: 'bg-amber',
    violet: 'bg-violet',
    cyan: 'bg-cyan',
    ask: 'bg-ask',
    bid: 'bg-bid',
    ink: 'bg-ink-100',
    muted: 'bg-ink-500',
};

/** How each weight looks as a control, which is the weight itself. */
const WIDTH_BARS: Readonly<Record<DrawingWidth, string>> = {
    thin: 'h-px',
    medium: 'h-[2px]',
    thick: 'h-[3px]',
};

/** How each line looks as a control, drawn the way it draws. */
const STYLE_BARS: Readonly<Record<DrawingStyle, string>> = {
    solid: 'border-t-2 border-solid',
    dashed: 'border-t-2 border-dashed',
    dotted: 'border-t-2 border-dotted',
};

const OPTION_CLASSES = 'grid size-8 shrink-0 place-items-center rounded-md border transition-colors';
const CHOSEN_CLASSES = 'border-phosphor/60 bg-phosphor/12';
const OFFERED_CLASSES = 'border-hairline hover:border-hairline-bright';

interface DrawingPropertiesProps {
    readonly controls: DrawingControls;
}

/**
 * Everything about the mark that is selected.
 *
 * Opened by the selection itself rather than by a control that has to be found:
 * a reader who has just pressed a mark has said what they want to work on, and
 * asking them to say it a second time is a press they should not have to make.
 */
export function DrawingProperties({ controls }: DrawingPropertiesProps): ReactElement | null {
    const translate = useTranslate();
    const selected = controls.selected;
    if (selected === null) {
        return null;
    }

    return (
        <div
            className="pointer-events-auto flex w-60 flex-col gap-3 rounded-xl border border-hairline bg-abyss-800/95 p-3 shadow-2xl shadow-black/50 backdrop-blur"
            role="group"
            aria-label={translate('drawing.properties')}
        >
            <Field title={translate('drawing.colour')}>
                {INSTANCE_TONES.map((tone) => (
                    <Option
                        key={tone}
                        label={tone}
                        isChosen={selected.tone === tone}
                        onPress={() => { controls.restyleSelected({ tone }); }}
                    >
                        <span className={`size-4 rounded-full ${TONE_SWATCHES[tone]}`} />
                    </Option>
                ))}
            </Field>

            <Field title={translate('drawing.width')}>
                {DRAWING_WIDTHS.map((width) => (
                    <Option
                        key={width}
                        label={translate(`drawing.width.${width}`)}
                        isChosen={readLook(selected).width === width}
                        onPress={() => { controls.restyleSelected({ width }); }}
                    >
                        <span className={`w-4 rounded-full bg-ink-200 ${WIDTH_BARS[width]}`} />
                    </Option>
                ))}
            </Field>

            <Field title={translate('drawing.line')}>
                {DRAWING_STYLES.map((style) => (
                    <Option
                        key={style}
                        label={translate(`drawing.line.${style}`)}
                        isChosen={readLook(selected).style === style}
                        onPress={() => { controls.restyleSelected({ style }); }}
                    >
                        <span className={`w-4 border-ink-200 ${STYLE_BARS[style]}`} />
                    </Option>
                ))}
            </Field>

            <button
                type="button"
                onClick={controls.removeSelected}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-hairline px-3 py-1.5 text-xs text-ink-400 transition-colors hover:border-ask/50 hover:text-ask"
            >
                <Trash2 className="size-3.5" />
                {translate('drawing.remove')}
            </button>
        </div>
    );
}

/**
 * Reads a mark's look, filling in whatever it does not say about itself.
 */
function readLook(drawing: Drawing): ReturnType<typeof resolveDrawingLook> {
    return resolveDrawingLook(drawing);
}

interface FieldProps {
    readonly title: string;
    readonly children: ReactNode;
}

/**
 * One named row of options, which is how a panel of them reads as a list.
 */
function Field({ title, children }: FieldProps): ReactElement {
    return (
        <div className="flex flex-col gap-1.5">
            <span className="text-[11px] text-ink-500">{title}</span>
            <div className="flex flex-wrap gap-1">{children}</div>
        </div>
    );
}

interface OptionProps {
    readonly label: string;
    readonly isChosen: boolean;
    readonly onPress: () => void;
    readonly children: ReactElement;
}

/**
 * One option, shown as the thing it would do rather than named.
 */
function Option({ label, isChosen, onPress, children }: OptionProps): ReactElement {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            aria-pressed={isChosen}
            onClick={onPress}
            className={`${OPTION_CLASSES} ${isChosen ? CHOSEN_CLASSES : OFFERED_CLASSES}`}
        >
            {children}
        </button>
    );
}
