import { type ReactElement, useState } from 'react';
import { readMarkFor } from '../../../shared/venues/venue-registry.ts';

export interface VenueMarkProps {
    readonly venue: string;
    readonly className?: string;
}

/**
 * A hue the venue's own name decides.
 *
 * Deterministic, so a venue keeps the same colour between sessions and between
 * readers: the mark has to be something the eye learns, and a colour that moves
 * is a colour nobody learns. Held at one saturation and one lightness so that
 * six of them side by side read as one set rather than as six accidents.
 *
 * @param venue - The venue's id.
 * @returns A hue in degrees.
 */
function hueOf(venue: string): number {
    let sum = 0;
    for (const character of venue) {
        sum = (sum * 31 + character.codePointAt(0)!) % 360;
    }
    return sum;
}

/**
 * The venue's own mark, or the letter it starts with.
 *
 * Guessed from the host the venue answers on, so it costs no contract change
 * for the ones that ship and none for the ones a reader brings.
 *
 * The letter is not a fallback so much as the other half of the design, because
 * the guess usually fails: of the six venues this build ships, one serves an
 * icon at the host its API answers on, and three of the remaining five block an
 * automated fetch of their brand host outright. So the letter is what most
 * readers will see, and it is given a colour of its own — decided by the name,
 * so it is the same every time — rather than being left to look like the
 * picture that did not load.
 */
export function VenueMark({ venue, className = 'size-4' }: VenueMarkProps): ReactElement {
    const [hasFailed, setHasFailed] = useState(false);
    const at = readMarkFor(venue);

    if (at === null || hasFailed) {
        return (
            <span
                aria-hidden
                style={{ background: `hsl(${hueOf(venue)} 45% 32%)` }}
                className={`grid shrink-0 place-items-center rounded text-[9px] font-semibold uppercase text-ink-100 ${className}`}
            >
                {venue.slice(0, 1)}
            </span>
        );
    }

    return (
        <img
            src={at}
            alt=""
            loading="lazy"
            onError={() => { setHasFailed(true); }}
            className={`shrink-0 rounded object-contain ${className}`}
        />
    );
}
