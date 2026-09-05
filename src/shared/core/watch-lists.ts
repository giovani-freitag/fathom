/**
 * One pair a reader kept, named by the venue as well as the symbol.
 *
 * Both, because BTCUSDT on two venues is two different recordings with two
 * different histories, and a list holding only the symbol would open whichever
 * of them the chart happened to find first.
 */
export interface WatchedPair {
    readonly venue: string;
    readonly symbol: string;
}

/** A list a reader made, in the order they put things in it. */
export interface WatchList {
    readonly id: string;
    readonly name: string;
    readonly pairs: readonly WatchedPair[];
}

/** The id of the list every reader starts with. */
export const FAVOURITES_ID = 'favourites';

/** As many lists as a reader can find their way around. */
export const MAXIMUM_LISTS = 20;

/** As many pairs in one list as the chart will offer to switch between. */
export const MAXIMUM_PAIRS_PER_LIST = 200;

/** How long a list's name may be before it stops fitting anywhere it is shown. */
export const MAXIMUM_LIST_NAME_LENGTH = 32;

/**
 * The lists a reader has before they have made any.
 *
 * One, empty, named by the interface rather than stored: the name is a phrase
 * in the reader's own language, and a name written into storage in English
 * would stay English after they changed languages.
 *
 * @returns The opening set of lists.
 */
export function openingLists(): readonly WatchList[] {
    return [{ id: FAVOURITES_ID, name: '', pairs: [] }];
}

/**
 * Whether two entries name the same pair on the same venue.
 *
 * @param one - An entry.
 * @param other - The entry to compare it against.
 * @returns True when they are the same recording.
 */
export function isSamePair(one: WatchedPair, other: WatchedPair): boolean {
    return one.venue === other.venue && one.symbol === other.symbol;
}

/**
 * The lists with one pair added to one of them.
 *
 * Adding a pair a list already holds changes nothing rather than duplicating
 * it, so a reader who stars the same row twice does not end up scrolling past
 * it twice.
 *
 * @param lists - The lists as they stand.
 * @param listId - Which list to add to.
 * @param pair - What to add.
 * @returns The lists, unchanged where the list is full or already holds it.
 */
export function withPairAdded(
    lists: readonly WatchList[],
    listId: string,
    pair: WatchedPair,
): readonly WatchList[] {
    return lists.map((list) => {
        if (list.id !== listId
            || list.pairs.some((held) => isSamePair(held, pair))
            || list.pairs.length >= MAXIMUM_PAIRS_PER_LIST) {
            return list;
        }
        return { ...list, pairs: [...list.pairs, pair] };
    });
}

/**
 * The lists with one pair taken out of one of them.
 *
 * @param lists - The lists as they stand.
 * @param listId - Which list to take it out of.
 * @param pair - What to remove.
 * @returns The lists, unchanged where that list did not hold it.
 */
export function withPairRemoved(
    lists: readonly WatchList[],
    listId: string,
    pair: WatchedPair,
): readonly WatchList[] {
    return lists.map((list) => (list.id === listId
        ? { ...list, pairs: list.pairs.filter((held) => !isSamePair(held, pair)) }
        : list));
}

/**
 * The lists with a new one at the end.
 *
 * @param lists - The lists as they stand.
 * @param name - What the reader called it.
 * @returns The lists, unchanged where the name is empty or there is no room.
 */
export function withListAdded(lists: readonly WatchList[], name: string): readonly WatchList[] {
    const wanted = name.trim().slice(0, MAXIMUM_LIST_NAME_LENGTH);
    if (wanted === '' || lists.length >= MAXIMUM_LISTS) {
        return lists;
    }

    const id = buildListId(wanted, lists);
    return [...lists, { id, name: wanted, pairs: [] }];
}

/**
 * The lists with one of them gone.
 *
 * The first list cannot be removed: it is where a reader who has made no lists
 * puts things, and a chart with nowhere to put a pair has no way of offering to.
 *
 * @param lists - The lists as they stand.
 * @param listId - Which to remove.
 * @returns The lists, unchanged where the list is the first one.
 */
export function withListRemoved(lists: readonly WatchList[], listId: string): readonly WatchList[] {
    if (listId === FAVOURITES_ID) {
        return lists;
    }
    return lists.filter((list) => list.id !== listId);
}

/**
 * The lists with one renamed.
 *
 * @param lists - The lists as they stand.
 * @param listId - Which to rename.
 * @param name - What to call it now.
 * @returns The lists, unchanged where the new name is empty.
 */
export function withListRenamed(
    lists: readonly WatchList[],
    listId: string,
    name: string,
): readonly WatchList[] {
    const wanted = name.trim().slice(0, MAXIMUM_LIST_NAME_LENGTH);
    if (wanted === '') {
        return lists;
    }
    return lists.map((list) => (list.id === listId ? { ...list, name: wanted } : list));
}

/**
 * Which lists hold a pair.
 *
 * @param lists - The lists as they stand.
 * @param pair - The pair being looked for.
 * @returns The ids of the lists holding it.
 */
export function findListsHolding(
    lists: readonly WatchList[],
    pair: WatchedPair,
): readonly string[] {
    return lists
        .filter((list) => list.pairs.some((held) => isSamePair(held, pair)))
        .map((list) => list.id);
}

/**
 * The lists as they can be trusted, out of whatever storage held.
 *
 * Storage is a file the reader can edit, so every field is checked rather than
 * assumed: a list whose pairs are not a list of pairs takes the whole picker
 * down on the first render that walks it.
 *
 * @param stored - Whatever was parsed out of storage.
 * @returns The readable lists, with the first one always present.
 */
export function readLists(stored: unknown): readonly WatchList[] {
    if (!Array.isArray(stored)) {
        return openingLists();
    }

    const read = stored
        .filter(isWatchList)
        .slice(0, MAXIMUM_LISTS)
        .map((list) => ({
            id: list.id,
            name: list.name.slice(0, MAXIMUM_LIST_NAME_LENGTH),
            pairs: list.pairs.filter(isWatchedPair).slice(0, MAXIMUM_PAIRS_PER_LIST),
        }));

    return read.some((list) => list.id === FAVOURITES_ID) ? read : [...openingLists(), ...read];
}

/**
 * An id nothing else answers to, out of what the reader called the list.
 *
 * A name of nothing but punctuation leaves no stem at all, and an empty id is
 * one that every later lookup matches or none does, depending on the lookup.
 */
function buildListId(name: string, lists: readonly WatchList[]): string {
    const stem = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const base = stem === '' ? 'list' : stem;

    let id = base;
    let suffix = 2;
    while (lists.some((list) => list.id === id)) {
        id = `${base}-${String(suffix)}`;
        suffix += 1;
    }
    return id;
}

/**
 * Whether something out of storage is a list.
 */
function isWatchList(candidate: unknown): candidate is WatchList {
    const list = candidate as Partial<WatchList> | null;
    return typeof list?.id === 'string'
        && list.id !== ''
        && typeof list.name === 'string'
        && Array.isArray(list.pairs);
}

/**
 * Whether something out of storage is a pair.
 */
function isWatchedPair(candidate: unknown): candidate is WatchedPair {
    const pair = candidate as Partial<WatchedPair> | null;
    return typeof pair?.venue === 'string' && pair.venue !== ''
        && typeof pair.symbol === 'string' && pair.symbol !== '';
}
