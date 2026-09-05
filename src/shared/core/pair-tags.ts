import { INSTANCE_TONES, type PlotTone } from './draw-plan.ts';

/**
 * One pair a reader kept, named by the venue as well as the symbol.
 *
 * Both, because BTCUSDT on two venues is two different recordings with two
 * different histories, and a tag holding only the symbol would open whichever
 * of them the chart happened to find first.
 */
export interface MarketPair {
    readonly venue: string;
    readonly symbol: string;
}

/**
 * A tag a reader made, and everything they put under it.
 *
 * A tag rather than a list because a pair belongs to more than one at once:
 * BTCUSDT is somebody's majors and their morning watch on the same morning, and
 * a list forces them to keep it twice and remember both.
 */
export interface PairTag {
    readonly id: string;
    /** Empty on the tag every reader starts with, which the interface names. */
    readonly label: string;
    /** The colour it is marked in, from the palette the chart already uses. */
    readonly tone: PlotTone;
    readonly pairs: readonly MarketPair[];
}

/** The id of the tag every reader starts with. */
export const FAVOURITES_ID = 'favourites';

/** As many tags as a reader can tell apart. */
export const MAXIMUM_TAGS = 20;

/** As many pairs under one tag as the chart will offer to switch between. */
export const MAXIMUM_PAIRS_PER_TAG = 200;

/** How long a label may be before it stops fitting anywhere it is shown. */
export const MAXIMUM_TAG_LABEL_LENGTH = 24;

/**
 * The tags a reader has before they have made any.
 *
 * One, empty, named by the interface rather than stored: the name is a phrase
 * in the reader's own language, and a name written into storage in English
 * would stay English after they changed languages.
 *
 * @returns The opening set of tags.
 */
export function openingTags(): readonly PairTag[] {
    return [{ id: FAVOURITES_ID, label: '', tone: 'phosphor', pairs: [] }];
}

/**
 * Whether two entries name the same pair on the same venue.
 *
 * @param one - An entry.
 * @param other - The entry to compare it against.
 * @returns True when they are the same recording.
 */
export function isSamePair(one: MarketPair, other: MarketPair): boolean {
    return one.venue === other.venue && one.symbol === other.symbol;
}

/**
 * The tags with one pair added to one of them.
 *
 * Tagging a pair twice changes nothing rather than duplicating it, so a reader
 * who presses the same row twice does not end up scrolling past it twice.
 *
 * @param tags - The tags as they stand.
 * @param tagId - Which tag to put it under.
 * @param pair - What to tag.
 * @returns The tags, unchanged where the tag is full or already holds it.
 */
export function withPairTagged(
    tags: readonly PairTag[],
    tagId: string,
    pair: MarketPair,
): readonly PairTag[] {
    return tags.map((tag) => {
        if (tag.id !== tagId
            || tag.pairs.some((held) => isSamePair(held, pair))
            || tag.pairs.length >= MAXIMUM_PAIRS_PER_TAG) {
            return tag;
        }
        return { ...tag, pairs: [...tag.pairs, pair] };
    });
}

/**
 * The tags with one pair taken out from under one of them.
 *
 * @param tags - The tags as they stand.
 * @param tagId - Which tag to take it out of.
 * @param pair - What to untag.
 * @returns The tags, unchanged where that tag did not hold it.
 */
export function withPairUntagged(
    tags: readonly PairTag[],
    tagId: string,
    pair: MarketPair,
): readonly PairTag[] {
    return tags.map((tag) => (tag.id === tagId
        ? { ...tag, pairs: tag.pairs.filter((held) => !isSamePair(held, pair)) }
        : tag));
}

/**
 * The tags with a new one at the end, in a colour nothing else is using.
 *
 * @param tags - The tags as they stand.
 * @param label - What the reader called it.
 * @returns The tags, unchanged where the label is empty or there is no room.
 */
export function withTagAdded(tags: readonly PairTag[], label: string): readonly PairTag[] {
    const wanted = label.trim().slice(0, MAXIMUM_TAG_LABEL_LENGTH);
    if (wanted === '' || tags.length >= MAXIMUM_TAGS) {
        return tags;
    }

    return [...tags, {
        id: buildTagId(wanted, tags),
        label: wanted,
        tone: chooseTagTone(tags),
        pairs: [],
    }];
}

/**
 * The tags with one of them gone.
 *
 * The first tag cannot be removed: it is where a reader who has made no tags
 * puts things, and a chart with nowhere to put a pair has no way of offering to.
 *
 * @param tags - The tags as they stand.
 * @param tagId - Which to remove.
 * @returns The tags, unchanged where the tag is the first one.
 */
export function withTagRemoved(tags: readonly PairTag[], tagId: string): readonly PairTag[] {
    if (tagId === FAVOURITES_ID) {
        return tags;
    }
    return tags.filter((tag) => tag.id !== tagId);
}

/**
 * The tags with one relabelled.
 *
 * @param tags - The tags as they stand.
 * @param tagId - Which to relabel.
 * @param label - What to call it now.
 * @returns The tags, unchanged where the new label is empty.
 */
export function withTagRelabelled(
    tags: readonly PairTag[],
    tagId: string,
    label: string,
): readonly PairTag[] {
    const wanted = label.trim().slice(0, MAXIMUM_TAG_LABEL_LENGTH);
    if (wanted === '') {
        return tags;
    }
    return tags.map((tag) => (tag.id === tagId ? { ...tag, label: wanted } : tag));
}

/**
 * The tags with one marked in a different colour.
 *
 * @param tags - The tags as they stand.
 * @param tagId - Which to recolour.
 * @param tone - What to mark it in.
 * @returns The tags, in the order they were already in.
 */
export function withTagRecoloured(
    tags: readonly PairTag[],
    tagId: string,
    tone: PlotTone,
): readonly PairTag[] {
    return tags.map((tag) => (tag.id === tagId ? { ...tag, tone } : tag));
}

/**
 * Which tags a pair carries.
 *
 * @param tags - The tags as they stand.
 * @param pair - The pair being looked for.
 * @returns The tags holding it, in the order the reader made them.
 */
export function findTagsHolding(
    tags: readonly PairTag[],
    pair: MarketPair,
): readonly PairTag[] {
    return tags.filter((tag) => tag.pairs.some((held) => isSamePair(held, pair)));
}

/**
 * The tags as they can be trusted, out of whatever storage held.
 *
 * Storage is a file the reader can edit, so every field is checked rather than
 * assumed: a tag whose pairs are not a list of pairs takes the whole picker
 * down on the first render that walks it.
 *
 * A reader who kept lists before this build stored a name and no colour, and
 * that reads as a tag with one handed out — the two differ by a colour and a
 * word, and dropping the lists would drop what they kept in them.
 *
 * @param stored - Whatever was parsed out of storage.
 * @returns The readable tags, with the first one always present.
 */
export function readTags(stored: unknown): readonly PairTag[] {
    if (!Array.isArray(stored)) {
        return openingTags();
    }

    const read: PairTag[] = [];
    for (const candidate of stored.slice(0, MAXIMUM_TAGS).filter(isPairTag)) {
        read.push({
            id: candidate.id,
            label: readLabel(candidate),
            tone: INSTANCE_TONES.find((tone) => tone === candidate.tone) ?? chooseTagTone(read),
            pairs: candidate.pairs.filter(isMarketPair).slice(0, MAXIMUM_PAIRS_PER_TAG),
        });
    }

    return read.some((tag) => tag.id === FAVOURITES_ID) ? read : [...openingTags(), ...read];
}

/**
 * A colour no tag is already marked in.
 *
 * @param tags - The tags as they stand.
 * @returns A free tone, or the next in rotation once every one is taken.
 */
export function chooseTagTone(tags: readonly PairTag[]): PlotTone {
    const taken = new Set(tags.map((tag) => tag.tone));
    return INSTANCE_TONES.find((tone) => !taken.has(tone))
        ?? INSTANCE_TONES[taken.size % INSTANCE_TONES.length]!;
}

/**
 * The colour after this tag's, skipping any another tag already carries.
 *
 * Skipping rather than stepping, because two tags in one colour is the state
 * the marks stop meaning anything in — and a reader cycling to a free colour
 * would otherwise have to press past every taken one to reach it.
 *
 * With more tags than colours there is nothing free to reach, and it steps to
 * the next one regardless: a control that answers a press with nothing reads as
 * a broken one, and the reader pressing it is the one asking for the repeat.
 *
 * @param tags - The tags as they stand.
 * @param tagId - Which tag is being recoloured.
 * @returns The next free tone, or the next in rotation once every one is taken.
 */
export function nextTagTone(tags: readonly PairTag[], tagId: string): PlotTone {
    const held = tags.find((tag) => tag.id === tagId);
    const taken = new Set(tags.filter((tag) => tag.id !== tagId).map((tag) => tag.tone));
    const at = INSTANCE_TONES.findIndex((tone) => tone === held?.tone);

    for (let step = 1; step < INSTANCE_TONES.length; step += 1) {
        const tone = INSTANCE_TONES[(at + step) % INSTANCE_TONES.length]!;
        if (!taken.has(tone)) {
            return tone;
        }
    }
    return INSTANCE_TONES[(at + 1) % INSTANCE_TONES.length]!;
}

/**
 * An id nothing else answers to, out of what the reader called the tag.
 *
 * A label of nothing but punctuation leaves no stem at all, and an empty id is
 * one that every later lookup matches or none does, depending on the lookup.
 */
function buildTagId(label: string, tags: readonly PairTag[]): string {
    const stem = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const base = stem === '' ? 'tag' : stem;

    let id = base;
    let suffix = 2;
    while (tags.some((tag) => tag.id === id)) {
        id = `${base}-${String(suffix)}`;
        suffix += 1;
    }
    return id;
}

/** What a stored tag is called, under either of the two names it was kept as. */
function readLabel(stored: StoredTag): string {
    const label = typeof stored.label === 'string' ? stored.label : stored.name;
    return (label ?? '').slice(0, MAXIMUM_TAG_LABEL_LENGTH);
}

/** A tag as storage may hold it, which includes how lists held one. */
type StoredTag = Partial<PairTag> & { readonly name?: string };

/**
 * Whether something out of storage is a tag.
 */
function isPairTag(candidate: unknown): candidate is StoredTag & { id: string; pairs: unknown[] } {
    const tag = candidate as StoredTag | null;
    return typeof tag?.id === 'string'
        && tag.id !== ''
        && (typeof tag.label === 'string' || typeof tag.name === 'string')
        && Array.isArray(tag.pairs);
}

/**
 * Whether something out of storage is a pair.
 */
function isMarketPair(candidate: unknown): candidate is MarketPair {
    const pair = candidate as Partial<MarketPair> | null;
    return typeof pair?.venue === 'string' && pair.venue !== ''
        && typeof pair.symbol === 'string' && pair.symbol !== '';
}
