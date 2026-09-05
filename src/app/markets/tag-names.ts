import type { PairTag } from '../../shared/core/pair-tags.ts';
import type { Translate } from '../i18n/translator.ts';

/**
 * What a tag is called, which the interface names for the first one.
 *
 * Named here rather than stored, because a name written into storage in one
 * language stays in that language after the reader changes it.
 *
 * @param tag - The tag being shown.
 * @param translate - The reader's dictionary.
 * @returns Its label.
 */
export function labelOf(tag: PairTag, translate: Translate): string {
    return tag.label === '' ? translate('markets.favourites') : tag.label;
}
