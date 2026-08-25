import type { ResolvedTheme } from '../core/theme.ts';

/** Chrome colours the canvas paints with. */
export interface RenderPalette {
    surface: string;
    hairline: string;
    hairlineFaint: string;
    axisBackdrop: string;
    /** Denser than the axis gutter: this one floats over lit depth. */
    readoutBackdrop: string;
    readoutShadow: string;
    inkPrimary: string;
    inkMuted: string;
    phosphor: string;
    bid: string;
    ask: string;
    amber: string;
    gapFill: string;
    gapStroke: string;
    profileBuy: string;
    profileSell: string;
    profileEdge: string;
    profileBackdrop: string;
    crosshair: string;
}

const DARK_PALETTE: RenderPalette = {
    surface: '#05080c',
    hairline: 'rgba(42, 61, 80, 0.55)',
    hairlineFaint: 'rgba(42, 61, 80, 0.28)',
    axisBackdrop: 'rgba(5, 8, 12, 0.82)',
    readoutBackdrop: 'rgba(6, 10, 15, 0.95)',
    readoutShadow: 'rgba(0, 0, 0, 0.5)',
    inkPrimary: '#dce7f1',
    inkMuted: '#62778b',
    phosphor: '#35e0c4',
    bid: '#2bd4a8',
    ask: '#ff5c72',
    amber: '#ffb454',
    gapFill: 'rgba(255, 180, 84, 0.07)',
    gapStroke: 'rgba(255, 180, 84, 0.35)',
    profileBuy: 'rgba(43, 212, 168, 0.5)',
    profileSell: 'rgba(255, 92, 114, 0.5)',
    profileEdge: 'rgba(220, 231, 241, 0.32)',
    profileBackdrop: 'rgba(3, 6, 10, 0.92)',
    crosshair: 'rgba(53, 224, 196, 0.6)',
};

const LIGHT_PALETTE: RenderPalette = {
    surface: '#f2f6fa',
    hairline: 'rgba(120, 141, 162, 0.38)',
    hairlineFaint: 'rgba(120, 141, 162, 0.16)',
    axisBackdrop: 'rgba(242, 246, 250, 0.86)',
    readoutBackdrop: 'rgba(255, 255, 255, 0.96)',
    readoutShadow: 'rgba(11, 22, 32, 0.18)',
    inkPrimary: '#0b1620',
    inkMuted: '#64788c',
    phosphor: '#0a9683',
    bid: '#0d9670',
    ask: '#d32741',
    amber: '#a86a00',
    gapFill: 'rgba(168, 106, 0, 0.09)',
    gapStroke: 'rgba(168, 106, 0, 0.4)',
    profileBuy: 'rgba(13, 150, 112, 0.45)',
    profileSell: 'rgba(211, 39, 65, 0.42)',
    profileEdge: 'rgba(11, 22, 32, 0.3)',
    profileBackdrop: 'rgba(255, 255, 255, 0.92)',
    crosshair: 'rgba(10, 150, 131, 0.65)',
};

/*
 * One object the painters keep a reference to, re-pointed in place when the
 * theme changes. Handing each painter a palette per paint would mean threading
 * it through every private helper for a value that changes twice a session.
 */
export const RENDER_PALETTE: RenderPalette = { ...DARK_PALETTE };

/**
 * Re-points the shared palette at a theme.
 *
 * @param theme - The theme to paint from now on.
 */
export function applyPaletteTheme(theme: ResolvedTheme): void {
    Object.assign(RENDER_PALETTE, theme === 'light' ? LIGHT_PALETTE : DARK_PALETTE);
}

export const RENDER_METRICS = {
    priceAxisWidth: 72,
    priceAxisWidthCompact: 58,
    timeAxisHeight: 22,
    profileWidth: 104,
    profileWidthCompact: 52,
    minimumBubbleRadius: 1.4,
    maximumBubbleRadius: 17,
    labelFont: '11px "Azeret Mono", ui-monospace, monospace',
    labelFontCompact: '10px "Azeret Mono", ui-monospace, monospace',
} as const;
