import type { ChoiceParameter, NumericParameter, ToggleParameter } from './draw-plan.ts';

/**
 * A figure knob under construction.
 *
 * Every step returns a whole, valid parameter rather than something needing a
 * closing call, so there is no build step to forget.
 */
export interface NumericBuilder extends NumericParameter {
    /** What the control is called. A phrase, or a key naming one. */
    called(label: string): NumericBuilder;
    /** The range the reader can travel, which a stored value is clamped to. */
    between(minimum: number, maximum: number): NumericBuilder;
    /** How far one nudge moves it. */
    by(step: number): NumericBuilder;
    /** Where it starts. */
    startingAt(defaultValue: number): NumericBuilder;
}

/** A knob that takes one of a fixed set of answers, under construction. */
export interface ChoiceBuilder extends ChoiceParameter {
    called(label: string): ChoiceBuilder;
    startingAt(defaultValue: string): ChoiceBuilder;
}

/** A switch, under construction. */
export interface ToggleBuilder extends ToggleParameter {
    called(label: string): ToggleBuilder;
    startingAt(defaultValue: boolean): ToggleBuilder;
}

function buildNumeric(parameter: NumericParameter): NumericBuilder {
    return {
        ...parameter,
        called: (label) => buildNumeric({ ...parameter, label }),
        between: (minimum, maximum) => buildNumeric({ ...parameter, minimum, maximum }),
        by: (step) => buildNumeric({ ...parameter, step }),
        startingAt: (defaultValue) => buildNumeric({ ...parameter, defaultValue }),
    };
}

function buildChoice(parameter: ChoiceParameter): ChoiceBuilder {
    return {
        ...parameter,
        called: (label) => buildChoice({ ...parameter, label }),
        startingAt: (defaultValue) => buildChoice({ ...parameter, defaultValue }),
    };
}

function buildToggle(parameter: ToggleParameter): ToggleBuilder {
    return {
        ...parameter,
        called: (label) => buildToggle({ ...parameter, label }),
        startingAt: (defaultValue) => buildToggle({ ...parameter, defaultValue }),
    };
}

/**
 * A whole-number knob.
 *
 * @param name - The key its value is stored under.
 * @returns A builder that is already a usable parameter.
 */
export function integerParameter(name: string): NumericBuilder {
    return buildNumeric({ name, kind: 'integer', defaultValue: 1, minimum: 1, maximum: 100 });
}

/**
 * A knob that takes a fraction.
 *
 * @param name - The key its value is stored under.
 * @returns A builder that is already a usable parameter.
 */
export function decimalParameter(name: string): NumericBuilder {
    return buildNumeric({ name, kind: 'decimal', defaultValue: 1, minimum: 0, maximum: 100 });
}

/**
 * A knob that takes one of a fixed set of answers.
 *
 * @param name - The key its value is stored under.
 * @param choices - What the reader may pick, the first being the default.
 * @returns A builder that is already a usable parameter.
 */
export function choiceParameter(name: string, choices: readonly string[]): ChoiceBuilder {
    return buildChoice({ name, kind: 'choice', choices, defaultValue: choices[0] ?? '' });
}

/**
 * A knob that is either on or off.
 *
 * @param name - The key its value is stored under.
 * @returns A builder that is already a usable parameter.
 */
export function toggleParameter(name: string): ToggleBuilder {
    return buildToggle({ name, kind: 'toggle', defaultValue: false });
}
