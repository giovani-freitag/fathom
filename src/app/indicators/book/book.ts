import {
    type FieldLayer,
    type IndicatorSettings,
    type NumericParameter,
    readSetting,
    readToggle,
    type ToggleParameter,
} from '../../../shared/core/draw-plan.ts';

/**
 * Where resting size starts registering at all.
 */
export const DEFAULT_FLOOR_PERCENTILE = 0.40;

/** Limits the two cuts are held inside, so neither can erase the other. */
export const DEPTH_CUT_RANGE = {
    floorMinimum: 0,
    floorMaximum: 0.9,
    floorStep: 0.01,
    saturationMinimum: 0.9,
    saturationMaximum: 1,
    // Half a percent, because the useful travel of the upper cut is the last
    // one percent: a whole step of it is the difference between reserving the
    // hot end for walls and handing it to a single outlier.
    saturationStep: 0.005,
} as const;

const COLOUR_GAIN: NumericParameter = {
    name: 'colourGain',
    kind: 'decimal',
    defaultValue: 1,
    minimum: 0.4,
    maximum: 3,
    step: 0.05,
};

const FLOOR_PERCENTILE: NumericParameter = {
    name: 'floorPercentile',
    kind: 'decimal',
    defaultValue: DEFAULT_FLOOR_PERCENTILE,
    minimum: DEPTH_CUT_RANGE.floorMinimum,
    maximum: DEPTH_CUT_RANGE.floorMaximum,
    step: DEPTH_CUT_RANGE.floorStep,
};

const SATURATION_PERCENTILE: NumericParameter = {
    name: 'saturationPercentile',
    kind: 'decimal',
    defaultValue: 0.995,
    minimum: DEPTH_CUT_RANGE.saturationMinimum,
    maximum: DEPTH_CUT_RANGE.saturationMaximum,
    step: DEPTH_CUT_RANGE.saturationStep,
};

const SHOW_EXECUTIONS: ToggleParameter = { name: 'showExecutions', kind: 'toggle', defaultValue: true };
const SHOW_PROFILE: ToggleParameter = { name: 'showProfile', kind: 'toggle', defaultValue: true };
const SHOW_GAPS: ToggleParameter = { name: 'showGaps', kind: 'toggle', defaultValue: true };

/**
 * The recorded book, and everything that is the book seen another way.
 *
 * The executions that crossed it and where in the price they landed are read
 * from the same recording, so they are switches here rather than layers beside
 * it. What feeds it belongs here too: which contracts are written and how much
 * room they may take.
 *
 * How much traded does not, though it was recorded alongside. A bar carries its
 * own volume, so that reading needs no book and is an indicator of its own.
 */
/** The id this layer is stored and found under. */
export const BOOK_LAYER_ID = 'depth';

export const BOOK_LAYER: FieldLayer = {
    label: 'layer.depth',
    about: 'layer.depth.help',
    parameters: [
        COLOUR_GAIN,
        FLOOR_PERCENTILE,
        SATURATION_PERCENTILE,
        SHOW_EXECUTIONS,
        SHOW_PROFILE,
        SHOW_GAPS,
    ],
};

/** What the book amounts to for the parts that draw it. */
export interface BookSettings {
    readonly isDepthVisible: boolean;
    readonly isTradeOverlayVisible: boolean;
    readonly isVolumeProfileVisible: boolean;
    /** Which stored shape the drawn window is read out of. */
    /**
     * Whether the stretches nothing was recorded through are marked.
     *
     * On by default and belonging to the book, because a hole in the book is
     * what a gap is: the price ran through it, and only the depth is missing.
     * A reader who has seen where the holes are can put the marks down; one who
     * has not must not be shown a smooth line across them.
     */
    readonly areGapsVisible: boolean;
    readonly colourGain: number;
    readonly depthFloorPercentile: number;
    readonly depthSaturationPercentile: number;
}

/**
 * Reads the book out of the settings the copy on the chart carries.
 *
 * @param settings - What the reader tuned, or undefined when no book is drawn.
 * @returns Which of its readings are drawn, and how the map is cut.
 */
export function readBookSettings(settings: IndicatorSettings | undefined): BookSettings {
    const book = settings ?? {};
    const isDepthVisible = settings !== undefined;
    return {
        isDepthVisible,
        // Everything read off the recording is drawn only while the book it was
        // read from is, because it is the same layer seen another way.
        isTradeOverlayVisible: isDepthVisible && readToggle(book, SHOW_EXECUTIONS),
        isVolumeProfileVisible: isDepthVisible && readToggle(book, SHOW_PROFILE),
        areGapsVisible: isDepthVisible && readToggle(book, SHOW_GAPS),
        colourGain: readSetting(book, COLOUR_GAIN),
        depthFloorPercentile: readSetting(book, FLOOR_PERCENTILE),
        depthSaturationPercentile: readSetting(book, SATURATION_PERCENTILE),
    };
}
