import type { ReactElement } from 'react';

export interface LaserPointerProps {
    /** Optional to match the icon set the dock draws the rest of its row from. */
    readonly size?: number;
}

/**
 * A laser pointer: the barrel, the beam, and the spot the beam lands on.
 *
 * Drawn here because the icon set has no laser in it, and the nearest things
 * in it name other tools — a crosshair is how the chart is measured and a
 * pointing hand is the control that selects.
 *
 * The spot is what makes it a laser rather than a wand. Rays leaving the tip
 * were tried first and read as sparkles: every icon with them looked like the
 * magic wand of some other editor. A beam that ends somewhere reads as light
 * travelling, which is the whole of what this tool does.
 *
 * @param props - The edge length, defaulting to the box the paths are drawn in.
 * @returns The icon, as a square of the given size.
 */
export function LaserPointer({ size = 24 }: LaserPointerProps): ReactElement {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            {/* A short barrel and a long beam, in that proportion on purpose:
                the pen sits two along in the same row and is a diagonal shaft
                too, so an even split of the box gave two icons one silhouette.
                What tells them apart is that this one thins out and lands. */}
            <path d="M8.6 15.4 5.4 18.6a2.3 2.3 0 0 1-3.2-3.2l3.2-3.2a2.3 2.3 0 0 1 3.2 3.2z" />
            <path d="m10.4 13.6 8-8" />
            {/* Filled, because at the size a dock draws this an outlined ring
                closes up into a blur and stops reading as a spot of light. */}
            <circle cx="20.4" cy="3.6" r="1.8" fill="currentColor" stroke="none" />
        </svg>
    );
}
