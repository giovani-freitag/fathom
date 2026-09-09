import type { ReactElement } from 'react';

export interface LaserPointerProps {
    /** Optional to match the icon set the dock draws the rest of its row from. */
    readonly size?: number;
}

/**
 * A laser: the beam, the point it lands on, and the light scattering off it.
 *
 * Drawn here because the icon set has no laser in it, and the nearest things
 * in it name other tools — a crosshair is how the chart is measured and a
 * pointing hand is the control that selects.
 *
 * The burst rather than the device. A handheld pointer was tried twice and
 * failed the same way both times: at the size a dock draws an icon, a barrel
 * held at an angle is the silhouette the pen two along already has, and the
 * detail that would separate them is the detail that is lost first. What is
 * left of a laser at eighteen pixels is a bright point with light coming off
 * it, and nothing else in the row looks anything like that.
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
            {/* The beam, running off the edge: it comes from somewhere the icon
                does not show, which is what makes the far end the point. */}
            <path d="M9 12h13" />
            {/* The scatter, drawn as one path so the rays keep one weight. */}
            <path d="M9 12H2.4m6.6 0L4.4 7.4M9 12l-4.6 4.6M9 12 7.2 5.6M9 12l-1.8 6.4m1.8-6.4 4.6-4.6M9 12l4.6 4.6" />
        </svg>
    );
}
