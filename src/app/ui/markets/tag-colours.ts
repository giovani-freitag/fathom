/**
 * Where a browser's own colour control opens, for a tag that has no named
 * colour yet.
 *
 * The chart's own teal rather than black: the picker opens on something the
 * reader recognises from the interface around it.
 */
export const OPENS_ON = '#35e0c4';

/**
 * Whether a glyph laid over this colour has to be dark to be read.
 *
 * A reader may name any colour there is, and half of them swallow white while
 * the other half swallow black.
 *
 * @param colour - The colour a glyph will sit on, as `#rrggbb`.
 * @returns True where the colour is light enough to need a dark glyph.
 */
export function isPale(colour: string): boolean {
    const value = Number.parseInt(colour.slice(1), 16);
    if (Number.isNaN(value)) {
        return false;
    }
    // Weighted the way an eye weighs them: green carries most of the brightness
    // a reader perceives, blue almost none.
    const red = (value >> 16) & 0xff;
    const green = (value >> 8) & 0xff;
    const blue = value & 0xff;
    return (red * 299 + green * 587 + blue * 114) / 1000 > 140;
}
