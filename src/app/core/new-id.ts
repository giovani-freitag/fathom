/**
 * How many bytes a version 4 identifier is made of.
 */
const BYTES_PER_ID = 16;

/**
 * An identifier for something the reader has just made.
 *
 * Not `crypto.randomUUID`, which a browser only exposes in a secure context —
 * HTTPS, or a page served from localhost. The chart is read from a phone over
 * plain HTTP on a home network, and there the property is not a function at
 * all: every attempt to draw a line threw before the mark was made, with
 * nothing on screen to say why. `getRandomValues` carries no such condition and
 * is the same source of randomness underneath.
 *
 * @returns A version 4 identifier, in the shape anything storing one expects.
 */
export function newId(): string {
    const bytes = new Uint8Array(BYTES_PER_ID);
    crypto.getRandomValues(bytes);
    // The version and variant bits, so this is a version 4 identifier rather
    // than sixteen bytes that merely look like one. What is written here is
    // read back by whatever parses it, and a stored id outlives the build.
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;

    const written = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return [
        written.slice(0, 8),
        written.slice(8, 12),
        written.slice(12, 16),
        written.slice(16, 20),
        written.slice(20),
    ].join('-');
}
