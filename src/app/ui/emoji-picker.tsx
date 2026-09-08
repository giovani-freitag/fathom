import { Search } from 'lucide-react';
import type { TranslationKey } from '../i18n/dictionaries/en.ts';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { EmojiRow } from '../../shared/core/emoji-catalogue.generated.ts';
import { CONTROL_INPUT_CLASSES } from './control-shell.ts';
import { EMOJI_GLYPHS } from '../../shared/core/drawing.ts';
import { useTranslate } from '../react/use-appearance.ts';

/** Where the recently used sit, which is a tab of its own before the groups. */
const RECENT_TAB = -1;

/** Every tab, in the order the strip offers them. */
const TABS = [RECENT_TAB, 0, 1, 3, 4, 5, 6, 7, 8, 9] as const;

type Tab = typeof TABS[number];

/** What each tab is called, spelled out so the phrases stay checkable. */
const TAB_LABELS: Readonly<Record<Tab, TranslationKey>> = {
    [RECENT_TAB]: 'emoji.recent',
    0: 'emoji.group.0',
    1: 'emoji.group.1',
    3: 'emoji.group.3',
    4: 'emoji.group.4',
    5: 'emoji.group.5',
    6: 'emoji.group.6',
    7: 'emoji.group.7',
    8: 'emoji.group.8',
    9: 'emoji.group.9',
};

/** The face each tab is named by, so the strip reads without room for words. */
const TAB_FACES: Readonly<Record<Tab, string>> = {
    [RECENT_TAB]: '\u{1F551}',
    0: '\u{1F600}',
    1: '\u{1F44B}',
    3: '\u{1F43B}',
    4: '\u{1F354}',
    5: '\u{2708}\u{FE0F}',
    6: '\u{26BD}',
    7: '\u{1F4A1}',
    8: '\u{1F523}',
    9: '\u{1F3C1}',
};

/**
 * Rows past which a search stops looking.
 *
 * A search for one letter matches most of the catalogue, and drawing nineteen
 * hundred buttons costs more than the reader gains from the ones past the fold.
 */
const MOST_SEARCH_HITS = 120;

export interface EmojiPickerProps {
    readonly chosen: string;
    readonly recent: readonly string[];
    readonly onPick: (glyph: string) => void;
}

/**
 * The emoji a reader can pin, as a phone offers them.
 *
 * The catalogue is fetched rather than bundled with the chart: it is nineteen
 * hundred names and the words to find them by, and a reader who never opens
 * this tool should not download it to look at a book. Until it lands the
 * shipped handful stands in, so the tool is usable the instant it opens.
 *
 * @param props - What is chosen, what was used lately, and where a pick goes.
 * @returns The picker, as a strip of tabs over a grid.
 */
export function EmojiPicker({ chosen, recent, onPick }: EmojiPickerProps): ReactElement {
    const translate = useTranslate();
    const catalogue = useEmojiCatalogue();
    const [tab, setTab] = useState<Tab>(RECENT_TAB);
    const [typed, setTyped] = useState('');

    const shown = useMemo(
        () => chooseShown({ catalogue, tab, typed, recent }),
        [catalogue, tab, typed, recent],
    );

    return (
        <div className="flex flex-col gap-1.5">
            <label className="relative flex items-center">
                <Search className="pointer-events-none absolute left-2 size-3.5 text-ink-500" />
                <input
                    type="search"
                    name="emojiSearch"
                    aria-label={translate('emoji.search')}
                    placeholder={translate('emoji.search')}
                    value={typed}
                    onChange={(event) => { setTyped(event.target.value); }}
                    className={`${CONTROL_INPUT_CLASSES} w-full pl-7 pr-2 text-xs placeholder:text-ink-500`}
                />
            </label>

            {/* Hidden while searching, because a search reaches across every
                group: a tab still showing as chosen would be saying the
                results came from it. */}
            {typed.trim() === '' && (
                <div role="tablist" aria-label={translate('drawing.emoji')} className="flex gap-0.5">
                    {TABS.map((group) => (
                        <button
                            key={group}
                            type="button"
                            role="tab"
                            aria-selected={tab === group}
                            aria-label={translate(TAB_LABELS[group])}
                            title={translate(TAB_LABELS[group])}
                            onClick={() => { setTab(group); }}
                            className={`grid h-7 flex-1 place-items-center rounded text-sm transition-colors ${
                                tab === group ? 'bg-abyss-700 text-ink-100' : 'text-ink-500 hover:bg-abyss-700/60'
                            }`}
                        >
                            <span aria-hidden="true">{TAB_FACES[group]}</span>
                        </button>
                    ))}
                </div>
            )}

            <div className="grid max-h-44 grid-cols-8 gap-0.5 overflow-y-auto overscroll-contain">
                {shown.map(([glyph, label]) => (
                    <button
                        key={glyph}
                        type="button"
                        aria-label={label}
                        title={label}
                        aria-pressed={chosen === glyph}
                        onClick={() => { onPick(glyph); }}
                        className={`grid size-7 place-items-center rounded text-base leading-none transition-colors ${
                            chosen === glyph ? 'bg-phosphor/15' : 'hover:bg-abyss-700'
                        }`}
                    >
                        <span>{glyph}</span>
                    </button>
                ))}
            </div>

            {shown.length === 0 && (
                <p className="px-1 py-2 text-center text-[11px] text-ink-500">
                    {translate('emoji.search.empty')}
                </p>
            )}
        </div>
    );
}

/**
 * The catalogue, once it has arrived.
 *
 * Fetched on mount rather than imported, so the weight of it is on the reader
 * who opened the picker and on nobody else. A failed fetch leaves the stand-in
 * showing rather than an empty grid: a page that has been offline since it
 * loaded can still pin the marks it shipped with.
 */
function useEmojiCatalogue(): readonly EmojiRow[] {
    const [rows, setRows] = useState<readonly EmojiRow[]>(STAND_IN);

    useEffect(() => {
        let isMounted = true;
        void import('../../shared/core/emoji-catalogue.generated.ts')
            .then((module) => {
                if (isMounted) {
                    setRows(module.EMOJI_CATALOGUE);
                }
            })
            .catch(() => undefined);
        return () => { isMounted = false; };
    }, []);

    return rows;
}

/** The shipped handful, shaped as catalogue rows so one grid draws either. */
const STAND_IN: readonly EmojiRow[] = EMOJI_GLYPHS.map((glyph) => [glyph, glyph, '', 0] as const);

/** What the grid is being asked to show. */
interface ShownQuery {
    readonly catalogue: readonly EmojiRow[];
    /** The group being shown, or the recently used. */
    readonly tab: Tab;
    /** What the reader is looking for, if anything. */
    readonly typed: string;
    /** What this reader has pinned, newest first. */
    readonly recent: readonly string[];
}

/**
 * Which rows the grid shows: a search across everything, or one group.
 *
 * A search reads the terms rather than the name alone, which is what lets
 * `celebrate` find the party popper and `angry` find every cross face. Words
 * are matched from their start, so `car` offers the cars before it offers
 * everything a scar and a card are in.
 *
 * @param query - Everything known, what is being shown, and what was typed.
 * @returns The rows to draw, in the order to draw them.
 */
function chooseShown({ catalogue, tab, typed, recent }: ShownQuery): readonly EmojiRow[] {
    const wanted = typed.trim().toLowerCase();
    if (wanted !== '') {
        return catalogue
            .filter((row) => matchesTerms(row[2], row[1], wanted))
            .slice(0, MOST_SEARCH_HITS);
    }
    if (tab !== RECENT_TAB) {
        return catalogue.filter((row) => row[3] === tab);
    }

    // Ordered by the reader rather than by the catalogue, because the point of
    // the row is that the one they want is at the front of it.
    const byGlyph = new Map(catalogue.map((row) => [row[0], row]));
    const used = recent.map((glyph) => byGlyph.get(glyph) ?? ([glyph, glyph, '', 0] as EmojiRow));
    return used.length > 0 ? used : STAND_IN;
}

/**
 * Whether one emoji answers to what was typed.
 *
 * @param terms - Every word it can be found by, space separated.
 * @param label - Its name, for a search that spans the words of it.
 * @param wanted - What the reader typed, lowercased and trimmed.
 * @returns True when a word starts with it, or the whole name contains it.
 */
function matchesTerms(terms: string, label: string, wanted: string): boolean {
    return terms.startsWith(wanted)
        || terms.includes(` ${wanted}`)
        || label.includes(wanted);
}
