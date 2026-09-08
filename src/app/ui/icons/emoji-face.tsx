import { useState, type ReactElement } from 'react';

/**
 * The faces the tool's own icon cycles through.
 *
 * Faces only, and no verdicts: the icon says what the tool is, and a tick or a
 * flame in the toolbar would read as a control that does that rather than as
 * a way in to every emoji there is.
 */
const FACES: readonly string[] = [
    '\u{1F600}', '\u{1F60E}', '\u{1F914}', '\u{1F62E}', '\u{1F929}',
    '\u{1F644}', '\u{1F621}', '\u{1F642}', '\u{1F97A}', '\u{1F92F}',
];

export interface EmojiFaceProps {
    readonly size?: number;
}

/**
 * The emoji tool's face: grey at rest, coloured and different under a pointer.
 *
 * Drawn as the glyph itself rather than as a line icon, because the tool is
 * the only one in the row that places somebody else's artwork rather than a
 * stroke of its own. Grey at rest so it sits at the weight of the icons beside
 * it — a full-colour face in a row of hairlines is a button shouting — and
 * coloured on approach, which is the moment it is about to be used.
 *
 * @param props - The edge length, which is the size every dock icon is drawn at.
 * @returns The face, as a square of the given size.
 */
export function EmojiFace({ size = 24 }: EmojiFaceProps): ReactElement {
    const [shown, setShown] = useState(0);

    return (
        <span
            aria-hidden="true"
            // Advanced on arrival rather than on a timer: a row of icons that
            // move on their own is a row that will not be read, and this one
            // changes only for the reader who went towards it.
            onPointerEnter={() => { setShown((one) => (one + 1) % FACES.length); }}
            className="grid size-full place-items-center opacity-60 grayscale transition-[filter,opacity] duration-150 group-hover:opacity-100 group-hover:grayscale-0 group-aria-pressed:opacity-100 group-aria-pressed:grayscale-0"
            style={{ fontSize: size, lineHeight: 1 }}
        >
            {FACES[shown]}
        </span>
    );
}
