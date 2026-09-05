import type { Translate } from '../i18n/translator.ts';
import type { WatchList } from '../../shared/core/watch-lists.ts';

/**
 * What a list is called, which the interface names for the first one.
 *
 * Named here rather than stored, because a name written into storage in one
 * language stays in that language after the reader changes it.
 *
 * @param list - The list being shown.
 * @param translate - The reader's dictionary.
 * @returns Its name.
 */
export function nameOf(list: WatchList, translate: Translate): string {
    return list.name === '' ? translate('markets.favourites') : list.name;
}
