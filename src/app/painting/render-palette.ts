/**
 * Chrome colours, kept in one place so the canvas and the DOM stay one design.
 *
 * The canvas cannot read CSS custom properties without a per-frame
 * `getComputedStyle`, which is why these are literals rather than tokens.
 */
export const RENDER_PALETTE = {
    surface: '#05080c',
    hairline: 'rgba(42, 61, 80, 0.55)',
    hairlineFaint: 'rgba(42, 61, 80, 0.28)',
    axisBackdrop: 'rgba(5, 8, 12, 0.82)',
    /** Denser than the axis gutter: this one floats over lit depth. */
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
} as const;

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
