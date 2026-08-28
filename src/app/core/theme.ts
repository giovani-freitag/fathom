/** What the reader picked. */
export type ThemeChoice = 'system' | 'light' | 'dark';

/** What that resolves to once the operating system has had its say. */
export type ResolvedTheme = 'light' | 'dark';

export const THEME_CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark'];

/**
 * The theme to paint, given a choice and what the host prefers.
 *
 * @param choice - The reader's selection.
 * @param prefersDark - Whether the host asks for a dark interface.
 * @returns The theme to apply.
 */
export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): ResolvedTheme {
    if (choice === 'system') {
        return prefersDark ? 'dark' : 'light';
    }
    return choice;
}

/**
 * How much of the grid a reader wants ruled across the chart.
 *
 * A liquidity map is already dense, and every line drawn over it is a line
 * competing with the data. The time lines are the ones that pollute: they run
 * the full height of the stack and there are one for every label, so they are
 * the half a reader is most likely to want gone.
 */
export type GridChoice = 'none' | 'price' | 'both';

export const GRID_CHOICES: readonly GridChoice[] = ['none', 'price', 'both'];
