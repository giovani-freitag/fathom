import { applyPaletteTheme } from './render-palette.ts';
import { DepthColourScale } from './depth-colour-scale.ts';
import type { ResolvedTheme } from '../core/theme.ts';

/**
 * Points everything the canvas paints with at a theme.
 *
 * @param theme - The theme to paint from now on.
 */
export function applyRenderTheme(theme: ResolvedTheme): void {
    applyPaletteTheme(theme);
    DepthColourScale.applyTheme(theme);
}
