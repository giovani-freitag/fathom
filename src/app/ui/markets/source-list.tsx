import { CONTROL_CHIP_CLASSES, CONTROL_CHOSEN_CLASSES, CONTROL_OFFERED_CLASSES } from '../control-shell.ts';
import type { PairTag } from '../../../shared/core/pair-tags.ts';
import { labelOf } from '../../markets/tag-names.ts';
import type { ReactElement } from 'react';
import { type Showing, TagNameField } from './markets-rail.tsx';
import { PANEL_ADD_CLASSES } from '../control-shell.ts';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { TagSwatch } from './tag-swatch.tsx';
import type { Translate } from '../../i18n/translator.ts';

/** Which kinds of source a list is showing. */
export type SourceKind = 'tag' | 'venue';

export interface SourceListProps {
    readonly tags: readonly PairTag[];
    readonly venues: readonly string[];
    readonly openTagId: string;
    readonly showing: Showing;
    /** Narrowed by what was typed in the search above, case-folded. */
    readonly query: string;
    /** Which kinds to draw, in this order. */
    readonly kinds: readonly SourceKind[];
    readonly translate: Translate;
    readonly onOpenTag: (tagId: string) => void;
    readonly onBrowse: (venue: string) => void;
    /** Makes one more tag, which is where a reader keeps what they found. */
    readonly onAddTag: (label: string) => void;
}

/**
 * Everything the listing can be pointed at, as rows of full height.
 *
 * A list rather than a menu because both halves of it grow: a reader keeps as
 * many tags as they like and installs as many connectors as they like, and a
 * dropdown that was comfortable with six of each is the same scroll bar inside
 * a scroll bar at thirty. Rows scroll; menus stack.
 *
 * The two kinds are drawn under headings of their own because they are not
 * alternatives of one thing: a tag holds pairs from any venue at once, and a
 * venue is a catalogue of its own.
 */
export function SourceList({
    tags,
    venues,
    openTagId,
    showing,
    query,
    kinds,
    translate,
    onOpenTag,
    onBrowse,
    onAddTag,
}: SourceListProps): ReactElement {
    const [isNaming, setIsNaming] = useState(false);
    const wanted = query.trim().toUpperCase();
    const matches = (said: string): boolean => wanted === '' || said.toUpperCase().includes(wanted);
    const shownTags = tags.filter((tag) => matches(labelOf(tag, translate)));
    const shownVenues = venues.filter((venue) => matches(venue));
    const isEmpty = (kinds.includes('tag') ? shownTags.length : 0)
        + (kinds.includes('venue') ? shownVenues.length : 0) === 0;

    if (isEmpty && !kinds.includes('tag')) {
        return (
            <p role="status" className="min-h-0 flex-1 px-3 py-4 text-xs leading-snug text-ink-500">
                {translate('markets.noSources')}
            </p>
        );
    }

    return (
        <div className="min-h-0 flex-1 overflow-y-auto">
            {kinds.includes('tag') && shownTags.length > 0 && (
                <section aria-labelledby="source-tags">
                    <h4 id="source-tags" className="px-3 py-1 field-label">
                        {translate('markets.yourTags')}
                    </h4>
                    <ul aria-labelledby="source-tags">
                        {shownTags.map((tag) => (
                            <li key={tag.id}>
                                <SourceRow
                                    said={labelOf(tag, translate)}
                                    count={tag.pairs.length}
                                    isOn={showing.kind === 'tag' && openTagId === tag.id}
                                    mark={<TagSwatch colour={tag.colour} className="size-2.5" />}
                                    onPress={() => { onOpenTag(tag.id); }}
                                />
                            </li>
                        ))}
                    </ul>

                    {/* The way to make one more, beside the ones there are.
                        It used to live on a strip this list replaced, and a
                        phone was left with no way to make a tag at all. */}
                    <div className="px-3 py-2">
                        {isNaming
                            ? (
                                <TagNameField
                                    translate={translate}
                                    onName={(label) => { onAddTag(label); setIsNaming(false); }}
                                    onGiveUp={() => { setIsNaming(false); }}
                                />
                            )
                            : (
                                <button
                                    type="button"
                                    onClick={() => { setIsNaming(true); }}
                                    className={`${PANEL_ADD_CLASSES} min-h-11 w-full`}
                                >
                                    <Plus className="size-3.5" />
                                    {translate('markets.newTag')}
                                </button>
                            )}
                    </div>
                </section>
            )}

            {kinds.includes('venue') && shownVenues.length > 0 && (
                <section aria-labelledby="source-venues">
                    <h4 id="source-venues" className="px-3 py-1 field-label">
                        {translate('markets.venues')}
                    </h4>
                    <ul aria-labelledby="source-venues">
                        {shownVenues.map((venue) => (
                            <li key={venue}>
                                <SourceRow
                                    said={venue}
                                    isOn={showing.kind === 'venue' && showing.venue === venue}
                                    onPress={() => { onBrowse(venue); }}
                                />
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </div>
    );
}

interface SourceRowProps {
    readonly said: string;
    readonly count?: number | undefined;
    readonly isOn: boolean;
    readonly mark?: ReactElement | undefined;
    readonly onPress: () => void;
}

/**
 * One source, at a size a thumb finds.
 */
function SourceRow({ said, count, isOn, mark, onPress }: SourceRowProps): ReactElement {
    return (
        <button
            type="button"
            aria-current={isOn}
            onClick={onPress}
            className={`flex min-h-12 w-full items-center gap-3 border-b border-hairline/40 px-3 text-left text-sm transition-colors hover:bg-abyss-700 ${
                isOn ? 'text-phosphor' : 'text-ink-200'
            }`}
        >
            {mark ?? <span className="size-2.5 shrink-0" />}
            <span className="min-w-0 flex-1 truncate">{said}</span>
            {count !== undefined && count > 0 && (
                <span aria-hidden className="shrink-0 rounded-full bg-current/15 px-1.5 text-[10px]">{count}</span>
            )}
        </button>
    );
}

export interface SourceTabsProps {
    /** Which body is showing: the pairs, or one kind of source. */
    readonly open: SourceKind | null;
    readonly translate: Translate;
    readonly onOpen: (kind: SourceKind | null) => void;
}

/**
 * The two kinds of source, as tabs that never grow.
 *
 * Two, because there are two kinds — however many tags and venues a reader
 * gathers. What grows is behind them, where a list can scroll.
 */
export function SourceTabs({ open, translate, onOpen }: SourceTabsProps): ReactElement {
    const tabs: readonly { kind: SourceKind; said: string }[] = [
        { kind: 'tag', said: translate('markets.yourTags') },
        { kind: 'venue', said: translate('markets.venues') },
    ];

    return (
        <div className="flex shrink-0 gap-1 border-b border-hairline px-2 py-2">
            {tabs.map((tab) => (
                <button
                    key={tab.kind}
                    type="button"
                    aria-pressed={open === tab.kind}
                    onClick={() => { onOpen(open === tab.kind ? null : tab.kind); }}
                    className={`${CONTROL_CHIP_CLASSES} h-9 flex-1 justify-center ${
                        open === tab.kind ? CONTROL_CHOSEN_CLASSES : CONTROL_OFFERED_CLASSES
                    }`}
                >
                    {tab.said}
                </button>
            ))}
        </div>
    );
}
