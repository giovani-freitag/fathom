import { Check, Tag as TagGlyph } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { labelOf } from '../../markets/tag-names.ts';
import type { MarketPair, PairTag } from '../../../shared/core/pair-tags.ts';
import type { ReactElement } from 'react';
import { ToneSwatch } from '../indicators/tone-swatch.tsx';
import type { Translate } from '../../i18n/translator.ts';

/** How many marks a row shows before it stops being a row and starts being a list. */
const MARKS_SHOWN = 3;

interface PairTagMenuProps {
    readonly pair: MarketPair;
    readonly tags: readonly PairTag[];
    /** Which of them this pair carries. */
    readonly held: ReadonlySet<string>;
    readonly translate: Translate;
    readonly onToggle: (tagId: string, isOn: boolean) => void;
}

/**
 * What a pair is filed under, and where that is changed.
 *
 * On the row itself rather than against a tag chosen elsewhere: filing used to
 * mean picking a tag in the rail and then pressing the row, which is two places
 * for one decision and no way at all to take a pair out of a tag you were not
 * already looking at.
 *
 * The trigger is the answer as well as the way in — the colours it carries, or
 * an outline where it carries none.
 */
export function PairTagMenu({ pair, tags, held, translate, onToggle }: PairTagMenuProps): ReactElement {
    return (
        // Not modal: the menu opens over a listing inside a card, and a modal
        // one hides the rest of that card from anything reading the page and
        // takes the listing's own scroll with it.
        <DropdownMenu.Root modal={false}>
            <DropdownMenu.Trigger
                aria-label={translate('markets.tagsFor', { symbol: pair.symbol })}
                title={translate('markets.tagsFor', { symbol: pair.symbol })}
                className="group grid w-11 shrink-0 place-items-center transition-colors hover:bg-abyss-700 data-[state=open]:bg-abyss-700"
            >
                {held.size === 0
                    ? (
                        <TagGlyph
                            size={14}
                            className="text-ink-500 transition-colors group-hover:text-ink-300"
                        />
                    )
                    : (
                        <span className="flex items-center gap-0.5">
                            {tags
                                .filter((tag) => held.has(tag.id))
                                .slice(0, MARKS_SHOWN)
                                .map((tag) => <ToneSwatch key={tag.id} tone={tag.tone} className="size-2.5" />)}
                        </span>
                    )}
            </DropdownMenu.Trigger>

            <DropdownMenu.Portal>
                <DropdownMenu.Content
                    align="start"
                    sideOffset={4}
                    collisionPadding={12}
                    className="z-[60] max-h-64 min-w-44 overflow-y-auto rounded-lg border border-hairline bg-abyss-800 p-1 shadow-2xl shadow-black/60"
                >
                    {tags.map((tag) => {
                        const isOn = held.has(tag.id);
                        const said = labelOf(tag, translate);
                        return (
                            <DropdownMenu.CheckboxItem
                                key={tag.id}
                                checked={isOn}
                                aria-label={translate(isOn ? 'markets.removeFrom' : 'markets.addTo', {
                                    symbol: pair.symbol,
                                    tag: said,
                                })}
                                // Kept open on a press: a pair going into two
                                // tags is the case tags exist for, and a menu
                                // that shuts on the first one makes it two trips.
                                onSelect={(event) => { event.preventDefault(); }}
                                onCheckedChange={(wanted) => { onToggle(tag.id, wanted); }}
                                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-ink-200 outline-none data-[highlighted]:bg-abyss-700 data-[highlighted]:text-ink-100"
                            >
                                <ToneSwatch tone={tag.tone} className="size-2.5 shrink-0" />
                                <span className="min-w-0 flex-1 truncate">{said}</span>
                                {isOn && <Check size={13} className="shrink-0 text-phosphor" />}
                            </DropdownMenu.CheckboxItem>
                        );
                    })}
                </DropdownMenu.Content>
            </DropdownMenu.Portal>
        </DropdownMenu.Root>
    );
}
