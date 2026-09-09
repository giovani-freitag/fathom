import { Trash2 } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import {
    type Drawing,
    type DrawingKind,
    DRAWING_STYLES,
    DRAWING_TRAILS,
    DRAWING_WIDTHS,
    type DrawingStyle,
    type DrawingTrail,
    type DrawingWidth,
    MAXIMUM_LABEL_LENGTH,
    readDrawingFields,
    readStoredGlyph,
    readStoredLabel,
    resolveDrawingLook,
} from '../../shared/core/drawing.ts';
import type { DrawingControls } from '../react/use-drawings.ts';
import {
    CONTROL_CHOSEN_CLASSES,
    CONTROL_INPUT_CLASSES,
    CONTROL_OFFERED_CLASSES,
    FLOATING_CARD_CLASSES,
} from './control-shell.ts';
import { EmojiPicker } from './emoji-picker.tsx';
import { ColourChoice } from './colour-choice.tsx';
import { INSTANCE_TONES } from '../../shared/core/draw-plan.ts';
import type { TagColour } from '../../shared/core/pair-tags.ts';
import { useTranslate } from '../react/use-appearance.ts';

/** How each weight looks as a control, which is the weight itself. */
const WIDTH_BARS: Readonly<Record<DrawingWidth, string>> = {
    thin: 'h-px',
    medium: 'h-[2px]',
    thick: 'h-[3px]',
};

/**
 * How each size looks as a control, which is the glyph at that size.
 *
 * The same three steps the weight control offers, because on an emoji the
 * stored weight is what the painter reads the type size out of. Shown as
 * letters rather than as bars: a reader setting how big a face will be is
 * choosing a size, and three bars of different thickness answered a question
 * about line weight that an emoji has never had.
 */
const SIZE_TYPE: Readonly<Record<DrawingWidth, string>> = {
    thin: 'text-[13px]',
    medium: 'text-[18px]',
    thick: 'text-[24px]',
};

const OPTION_CLASSES = 'grid size-8 shrink-0 place-items-center rounded-md border transition-colors touch:size-9';

interface DrawingPropertiesProps {
    readonly controls: DrawingControls;
}

/**
 * The mark that is selected, or the tool that is about to draw one.
 *
 * Opened by the selection itself rather than by a control that has to be found:
 * a reader who has just pressed a mark has said what they want to work on, and
 * asking them to say it a second time is a press they should not have to make.
 *
 * Opened by arming a tool as well, because some marks can never be selected. A
 * laser is gone by the time the hand lifts, so before the stroke is the only
 * moment its colour and weight can be set at all; and a reader who knows they
 * want a red level should say so once rather than draw a level and correct it.
 *
 * @param props - The drawing controls, which carry both the selection and the tool.
 * @returns The panel, or nothing while neither a mark nor a tool is in hand.
 */
export function DrawingProperties({ controls }: DrawingPropertiesProps): ReactElement | null {
    const translate = useTranslate();
    const selected = controls.selected;
    const kind = selected?.kind ?? controls.armedTool;
    if (kind === null) {
        return null;
    }

    const isSettingUp = selected === null;
    const fields = readDrawingFields(kind);
    const look = readLook(selected, controls, kind);
    const restyle = isSettingUp ? controls.restylePending : controls.restyleSelected;

    return (
        <div
            // As wide as the widest row it holds, and never wider than the
            // screen. Fixed at that width it was the whole of a three hundred
            // and twenty pixel phone, edge to edge with the chart nowhere in
            // sight; on a phone the rows wrap instead, which is the trade a
            // narrow screen is for.
            className={`${FLOATING_CARD_CLASSES} flex w-full max-w-72 flex-col gap-3 sm:max-w-none sm:w-80`}
            role="group"
            aria-label={translate(isSettingUp ? 'drawing.tool.setup' : 'drawing.properties')}
        >
            {/* First, because it is the only field a reader arrives with an
                answer for: the rest are chosen by looking, this one by
                remembering why the mark was made. */}
            {fields.hasLabel && (
                <Field title={translate('drawing.label')}>
                    <input
                        type="text"
                        name="drawingLabel"
                        aria-label={translate('drawing.label')}
                        value={look.label}
                        maxLength={MAXIMUM_LABEL_LENGTH}
                        placeholder={translate('drawing.label.placeholder')}
                        onChange={(event) => { restyle({ label: event.target.value }); }}
                        className={`${CONTROL_INPUT_CLASSES} px-2 text-xs placeholder:text-ink-500`}
                    />
                </Field>
            )}

            {fields.hasGlyph && (
                <EmojiPicker
                    chosen={look.glyph}
                    recent={controls.recentGlyphs}
                    onPick={(glyph) => { restyle({ glyph }); }}
                />
            )}

            {fields.hasTone && (
                <Field title={translate('drawing.colour')}>
                    <ColourChoice
                        colour={look.tone ?? INSTANCE_TONES[0]!}
                        said={translate('drawing.colour')}
                        translate={translate}
                        onPick={(tone) => { restyle({ tone }); }}
                    />
                </Field>
            )}

            <Field title={translate(fields.hasGlyph ? 'drawing.size' : 'drawing.width')}>
                {DRAWING_WIDTHS.map((width) => (
                    <Option
                        key={width}
                        label={translate(fields.hasGlyph ? `drawing.size.${width}` : `drawing.width.${width}`)}
                        isChosen={look.width === width}
                        onPress={() => { restyle({ width }); }}
                    >
                        {fields.hasGlyph
                            ? <span className={`${SIZE_TYPE[width]} leading-none`}>{look.glyph}</span>
                            : <span className={`w-4 rounded-full bg-ink-200 ${WIDTH_BARS[width]}`} />}
                    </Option>
                ))}
            </Field>

            {fields.hasTrail && (
                <Field title={translate('drawing.trail')}>
                    {DRAWING_TRAILS.map((trail) => (
                        <Option
                            key={trail}
                            label={translate(`drawing.trail.${trail}`)}
                            isChosen={look.trail === trail}
                            onPress={() => { restyle({ trail }); }}
                        >
                            {/* Shown as the length it is: three words would be
                                three words to read, and what a reader is
                                choosing between is how far the light runs. */}
                            <span className={`h-0.5 rounded-full bg-ink-200 ${TRAIL_BARS[trail]}`} />
                        </Option>
                    ))}
                </Field>
            )}

            {fields.hasStyle && (
                <Field title={translate('drawing.line')}>
                    {DRAWING_STYLES.map((style) => (
                        <Option
                            key={style}
                            label={translate(`drawing.line.${style}`)}
                            isChosen={look.style === style}
                            onPress={() => { restyle({ style }); }}
                        >
                            <span className={`w-4 border-ink-200 ${STYLE_BARS[style]}`} />
                        </Option>
                    ))}
                </Field>
            )}

            {/* The icon alone, aligned with the fields rather than spanning
                them: it is one action among a card of settings, and a bar
                across the foot reads as the thing the card is for. */}
            {selected !== null && (
                <div className="flex justify-end">
                    <button
                        type="button"
                        onClick={controls.removeSelected}
                        title={translate('drawing.remove')}
                        aria-label={translate('drawing.remove')}
                        className="grid size-7 place-items-center rounded-lg text-ink-500 transition-colors hover:bg-ask/10 hover:text-ask"
                    >
                        <Trash2 className="size-4" />
                    </button>
                </div>
            )}
        </div>
    );
}

/** How each trail reads as a control, which is the length of it. */
const TRAIL_BARS: Readonly<Record<DrawingTrail, string>> = {
    short: 'w-2',
    medium: 'w-4',
    long: 'w-6',
};

/** How each line looks as a control, drawn the way it draws. */
const STYLE_BARS: Readonly<Record<DrawingStyle, string>> = {
    solid: 'border-t-2 border-solid',
    dashed: 'border-t-2 border-dashed',
    dotted: 'border-t-2 border-dotted',
};

/** Everything the controls show, whether it is a mark's or a tool's. */
interface ShownLook {
    readonly tone: TagColour | null;
    readonly label: string;
    readonly trail: DrawingTrail;
    readonly width: DrawingWidth;
    readonly style: DrawingStyle;
    readonly glyph: string;
}

/**
 * What the controls should read as chosen.
 *
 * Read off the mark when there is one, and off the tool when there is not.
 * A mark stored before either field existed says nothing about them and has to
 * be shown anyway, which is what the fallbacks are for.
 *
 * @param selected - The mark being restyled, or null while a tool is being set up.
 * @param controls - Where the tool's own look is kept.
 * @param kind - What is being drawn, for the emoji a tool has not chosen yet.
 * @returns Every setting the panel can show, always all of them.
 */
function readLook(
    selected: Drawing | null,
    controls: DrawingControls,
    kind: DrawingKind,
): ShownLook {
    if (selected === null) {
        return controls.pending;
    }
    return {
        ...resolveDrawingLook(selected),
        tone: selected.tone,
        label: readStoredLabel(selected),
        trail: controls.pending.trail,
        glyph: kind === 'emoji' ? readStoredGlyph(selected) : controls.pending.glyph,
    };
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
            className={`${OPTION_CLASSES} ${isChosen ? CONTROL_CHOSEN_CLASSES : CONTROL_OFFERED_CLASSES}`}
        >
            {children}
        </button>
    );
}
