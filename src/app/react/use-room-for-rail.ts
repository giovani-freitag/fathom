import { type RefObject } from 'react';
import { useElementSize } from './use-element-size.ts';

/**
 * How wide a card has to be before a rail down its side is worth the room.
 *
 * The rail is two hundred and twenty-four pixels, and a listing row carries a
 * symbol, a venue and a word at the end — three hundred and twenty at the very
 * least. Below the sum of those the rail is not a shortcut, it is the reason
 * there is nowhere to put the answer.
 */
const RAIL_NEEDS_PX = 560;

/**
 * Whether a card has room to lay its targets down one side.
 *
 * Measured off the card rather than off the window, because the two disagree.
 * The contracts listing is mounted in a dropdown eight hundred pixels wide and
 * in a settings column two hundred and eighty-eight wide, and asking the window
 * gave the same answer to both: on a fourteen-hundred-pixel screen the settings
 * column laid out a two-hundred-and-twenty-four pixel rail and left sixty-four
 * pixels for a thousand contracts, which then scrolled sideways.
 *
 * False until the first measurement lands, which is the safe way round: the
 * narrow shape asks the same question through a control that fits anywhere,
 * and the wide one cannot fit at all in a box it was not measured for.
 *
 * @param boxRef - The card whose room is in question.
 * @returns True where a rail fits beside the rows.
 */
export function useHasRoomForRail(boxRef: RefObject<HTMLElement | null>): boolean {
    return useElementSize(boxRef).width >= RAIL_NEEDS_PX;
}
