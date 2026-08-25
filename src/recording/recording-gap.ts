/**
 * A window during which nothing was recorded.
 *
 * Order book history cannot be backfilled from any public venue, so an
 * unrecorded window is a fact the renderer must draw rather than interpolate
 * across.
 */
export interface RecordingGap {
    readonly gapStartedAtMs: number;
    readonly gapEndedAtMs: number;
    readonly gapReason: string;
}
