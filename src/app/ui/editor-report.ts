import type { DiscardedWork, EditorStatus } from '../react/use-addon-editor.ts';
import type { TranslationKey } from '../i18n/dictionaries/en.ts';

/** What the panel has to say about the reading in the editor, as one answer. */
export type EditorReport =
    /** Nothing has been compiled yet. */
    | { readonly kind: 'starting' }
    /** It builds and the chart is drawing it. */
    | { readonly kind: 'drawing'; readonly label: string }
    /** It built, and threw while the chart drew it. */
    | { readonly kind: 'threw'; readonly message: string }
    /** The compiler refused it. */
    | { readonly kind: 'faulted'; readonly faults: EditorStatus & { kind: 'faulted' } }
    /** Something outside the reading went wrong. */
    | { readonly kind: 'broken'; readonly message: string };

/**
 * Settles what the panel says when more than one thing has something to report.
 *
 * A throw is only about code that built, so it is only worth saying while the
 * editor still holds that code. Put ahead of the faults unconditionally, a throw
 * from a reading since replaced sat over the compiler's own answer, hiding the
 * reason the reading now in the editor would not build.
 *
 * @param status - What the last compile settled on, or null before the first.
 * @param drawFailure - What the reading threw while being drawn, where it did.
 * @returns The one thing worth saying.
 */
export function reportOn(status: EditorStatus | null, drawFailure: string | null): EditorReport {
    if (drawFailure !== null && status?.kind === 'ready') {
        return { kind: 'threw', message: drawFailure };
    }
    if (status === null) {
        return { kind: 'starting' };
    }
    if (status.kind === 'ready') {
        return { kind: 'drawing', label: status.label };
    }
    if (status.kind === 'broken') {
        return { kind: 'broken', message: status.message };
    }
    return { kind: 'faulted', faults: status };
}

/**
 * What the panel says about work that has just left the editor.
 *
 * Three outcomes, not two: a reading taken off the shelf is gone, a draft
 * replaced is lost, and a saved reading replaced is neither — it is still on
 * the shelf and reopening it costs a click. Told it was closed without being
 * saved, a reader who had just saved it is being told their save did not take.
 *
 * @param discarded - The work that left the editor.
 * @returns The line to render for it.
 */
export function sayOfDiscarded(discarded: DiscardedWork): TranslationKey {
    if (discarded.wasDeleted) {
        return 'indicators.removed';
    }

    return discarded.wasFiled ? 'editor.closed' : 'editor.replaced';
}
