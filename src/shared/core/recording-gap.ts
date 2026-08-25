/**
 * A window during which nothing was recorded.
 */
export interface RecordingGap {
    readonly gapStartedAtMs: number;
    readonly gapEndedAtMs: number;
    readonly gapReason: string;
}
