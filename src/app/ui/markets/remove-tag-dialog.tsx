import { ConfirmDialog } from '../confirm-dialog.tsx';
import { labelOf } from '../../markets/tag-names.ts';
import type { PairTag } from '../../../shared/core/pair-tags.ts';
import type { ReactElement } from 'react';
import type { Translate } from '../../i18n/translator.ts';

interface RemoveTagDialogProps {
    /** The tag being taken away, or nothing where none is. */
    readonly tag: PairTag | null;
    readonly translate: Translate;
    readonly onGiveUp: () => void;
    readonly onConfirm: (tagId: string) => void;
}

/**
 * What a reader is asked before a tag and everything under it goes.
 *
 * Written once because a tag can be taken away from two places now — the row in
 * the rail, and the card a phone edits it on — and the question is the same one
 * whichever was pressed.
 */
export function RemoveTagDialog({ tag, translate, onGiveUp, onConfirm }: RemoveTagDialogProps): ReactElement {
    return (
        <ConfirmDialog
            isOpen={tag !== null}
            onOpenChange={(isOpen) => { if (!isOpen) { onGiveUp(); } }}
            title={translate('markets.removeTagTitle')}
            body={translate('markets.removeTagBody', {
                tag: tag === null ? '' : labelOf(tag, translate),
                // Counted in words rather than glued to a plural that is wrong
                // for exactly one of them.
                count: tag?.pairs.length === 1
                    ? translate('markets.onePair')
                    : translate('markets.somePairs', { count: String(tag?.pairs.length ?? 0) }),
            })}
            confirmLabel={translate('markets.removeTagConfirm')}
            onConfirm={() => {
                if (tag !== null) {
                    onConfirm(tag.id);
                }
                onGiveUp();
            }}
        />
    );
}
