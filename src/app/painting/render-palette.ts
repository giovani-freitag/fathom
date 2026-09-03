import type { PlotTone } from '../../shared/core/draw-plan.ts';
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
    /**
     * What a figure written along an axis is drawn in.
     *
     * A step brighter than the muted ink it used to share. Muted is for a
     * decoration a reader is meant to look past — a dashed midline, an inactive
     * edge — and an axis label is the opposite of that: it is small, it is
     * monospaced, and it is the only thing on the screen that says what any of
     * the rest of it is worth. At the muted step it read at 4.4 to 1.
     */
    axisLabel: string;
    phosphor: string;
    bid: string;
    ask: string;
    amber: string;
    violet: string;
    cyan: string;
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
    axisLabel: '#7d92a6',
    phosphor: '#35e0c4',
    bid: '#2bd4a8',
    ask: '#ff5c72',
    amber: '#ffb454',
    violet: '#b48ef7',
    cyan: '#57c7ff',
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
    axisLabel: '#4f6376',
    phosphor: '#087a6b',
    bid: '#0d9670',
    ask: '#d32741',
    amber: '#a86a00',
    violet: '#6d3fd4',
    cyan: '#0f6fb5',
    gapFill: 'rgba(168, 106, 0, 0.09)',
    gapStroke: 'rgba(168, 106, 0, 0.4)',
    profileBuy: 'rgba(13, 150, 112, 0.45)',
    profileSell: 'rgba(211, 39, 65, 0.42)',
    profileEdge: 'rgba(11, 22, 32, 0.3)',
    profileBackdrop: 'rgba(255, 255, 255, 0.92)',
    crosshair: 'rgba(8, 122, 107, 0.65)',
};

/*
 * One object the painters keep a reference to, re-pointed in place when the
 * theme changes. Handing each painter a palette per paint would mean threading
 * it through every private helper for a value that changes twice a session.
 */
export const RENDER_PALETTE: RenderPalette = { ...DARK_PALETTE };

/**
 * The palette a theme paints in, whether or not it is the one in force.
 *
 * For anything that has to paint in a theme rather than in the theme: the
 * in-page editor carries its own two, and a third hand-written copy of these
 * colours is a third thing to keep in step.
 *
 * @param theme - The theme to read.
 * @returns The colours that theme paints with.
 */
export function readPaletteFor(theme: ResolvedTheme): RenderPalette {
    return theme === 'light' ? LIGHT_PALETTE : DARK_PALETTE;
}

/**
 * Re-points the shared palette at a theme.
 *
 * @param theme - The theme to paint from now on.
 */
export function applyPaletteTheme(theme: ResolvedTheme): void {
    Object.assign(RENDER_PALETTE, theme === 'light' ? LIGHT_PALETTE : DARK_PALETTE);
}

/** The palette a tone resolves against, chosen by the host and not the author. */
const TONE_COLOURS: Record<PlotTone, () => string> = {
    bid: () => RENDER_PALETTE.bid,
    ask: () => RENDER_PALETTE.ask,
    amber: () => RENDER_PALETTE.amber,
    violet: () => RENDER_PALETTE.violet,
    cyan: () => RENDER_PALETTE.cyan,
    phosphor: () => RENDER_PALETTE.phosphor,
    ink: () => RENDER_PALETTE.inkPrimary,
    muted: () => RENDER_PALETTE.inkMuted,
};

/**
 * The colour a tone stands for in the theme in force.
 *
 * Read through a call rather than held: the palette is re-pointed in place on a
 * theme change, and anything that captured a colour would keep the old one.
 *
 * @param tone - The tone a plan or a mark named.
 * @returns The colour to paint it in.
 */
export function resolveToneColour(tone: PlotTone): string {
    return TONE_COLOURS[tone]();
}

export const RENDER_METRICS = {
    priceAxisWidth: 72,
    priceAxisWidthCompact: 46,
    timeAxisHeight: 22,
    profileWidth: 104,
    profileWidthCompact: 32,
    minimumBubbleRadius: 1.4,
    maximumBubbleRadius: 17,
    labelFont: '11px "Azeret Mono", ui-monospace, monospace',
    labelFontCompact: '10px "Azeret Mono", ui-monospace, monospace',
} as const;
