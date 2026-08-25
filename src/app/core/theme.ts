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
