import type { AddonLogLine } from '../addons/addon-console.ts';

/**
 * Whether the console has to say which reading printed each line.
 *
 * A name on every line of a single reading's own output is a word the reader
 * already knows. A line from anywhere else is the opposite: left bare beside a
 * reading that did not print it, it reads as that reading's, which is how
 * output from a reading since closed comes to look like the one on screen.
 *
 * @param lines - Everything the console is holding.
 * @param openName - What the reading in the editor calls itself.
 * @returns True where a line could be taken for the open reading's own.
 */
export function namesTheSource(lines: readonly AddonLogLine[], openName: string): boolean {
    const sources = new Set(lines.map((line) => line.from).filter((from) => from !== ''));
    if (sources.size === 0) {
        return false;
    }

    return sources.size > 1 || !sources.has(openName);
}
