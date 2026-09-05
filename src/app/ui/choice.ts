import type { ReactNode } from 'react';

/**
 * One answer to a question the chart asks.
 *
 * The same shape whichever way it is offered: laid out where there is room, or
 * folded into a menu where there is not. Two shapes meant a choice gained or
 * lost a reason for being unpickable depending on which control happened to be
 * rendering it.
 */
export interface Choice {
    readonly value: string;
    readonly label: string;
    /** Set beside the label, for a figure the choice is about. */
    readonly detail?: string;
    /**
     * Shown before the label, wherever the choice appears.
     *
     * A flag, or the shape a theme takes: what the reader recognises before
     * they have read the word.
     */
    readonly icon?: ReactNode;
    /**
     * The heading this choice is filed under, where the answers are of more
     * than one kind.
     *
     * A reader's own tags and the venues on offer are both answers to "what am
     * I looking at", and listed flat they read as one list of things that are
     * not alike.
     */
    readonly group?: string;
    readonly isDisabled?: boolean;
    /** Why it cannot be picked, for the reader who tries. */
    readonly title?: string;
}
