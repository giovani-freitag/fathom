import { CandlePainter } from './candles/candle-painter.ts';
import { DepthColourScale } from './book/depth-colour-scale.ts';
import { DepthLayerPainter } from './book/depth-layer-painter.ts';
import type { FieldBackgroundPainter, FieldLayerPainter, ThemedLayer } from '../painting/render-types.ts';
import type { ResolvedTheme } from '../core/theme.ts';
import { TradePainter } from './book/trade-painter.ts';
import { VolumeProfilePainter } from './book/volume-profile-painter.ts';

/**
 * Everything the host paints on the chart, contributed by the layers.
 *
 * This is where a layer plugs into the drawing. The renderer walks the list and
 * asks each member whether it is drawn; it names none of them, so a new one is
 * a member added here rather than a branch opened there.
 *
 * @returns The painters, in the order they are drawn.
 */
export function buildFieldPainters(): readonly FieldLayerPainter[] {
    const painters: readonly FieldLayerPainter[] = [
        new VolumeProfilePainter(),
        new CandlePainter(),
        new TradePainter(),
    ];
    return [...painters].sort((first, second) => first.order - second.order);
}

/**
 * The layers that paint on a surface of their own and hold what they built.
 *
 * @returns The painters, in the order they are drawn.
 */
export function buildBackgroundPainters(): readonly FieldBackgroundPainter[] {
    return [new DepthLayerPainter()];
}

/** The layers that pre-render colours of their own. */
const THEMED_LAYERS: readonly ThemedLayer[] = [DepthColourScale];

/**
 * Tells every layer that colours itself which theme to colour with.
 *
 * @param theme - The theme to paint from now on.
 */
export function applyLayerThemes(theme: ResolvedTheme): void {
    for (const layer of THEMED_LAYERS) {
        layer.applyTheme(theme);
    }
}
