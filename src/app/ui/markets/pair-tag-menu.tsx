import { LIST_ROW_CLASSES } from '../control-shell.ts';
import { Check, Tag as TagGlyph } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { labelOf } from '../../markets/tag-names.ts';
import type { MarketPair, PairTag } from '../../../shared/core/pair-tags.ts';
import type { ReactElement } from 'react';
import { TagSwatch } from './tag-swatch.tsx';
import type { Translate } from '../../i18n/translator.ts';

/**
 * Which mark sits on top, the rest stacking down from it.
 *
 * High enough that the fifth tag on a pair is still above the row's own ground
 * rather than behind it, which is where counting down from zero would put it.
 */
const TOPMOST_MARK = 4;

interface PairTagMenuProps {
    /**
     * Whether the menu behind this row's marks is showing.
     *
     * Controlled from the table so that only one row carries a menu at a time.
     * A menu of its own on every row cost about four milliseconds each to
     * mount, and a listing draws a hundred and fifty of them: three quarters of
     * a second in which the screen answered nothing, right after the press that
     * asked for it.
     */
    readonly isOpen: boolean;
    readonly onOpenChange: (isOpen: boolean) => void;
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
export function PairTagMenu({
    isOpen,
    onOpenChange,
    pair,
    tags,
    held,
    translate,
    onToggle,
}: PairTagMenuProps): ReactElement {
    return (
        // Not modal: the menu opens over a listing inside a card, and a modal
        // one hides the rest of that card from anything reading the page and
        // takes the listing's own scroll with it.
        <DropdownMenu.Root modal={false} open={isOpen} onOpenChange={onOpenChange}>
            <DropdownMenu.Trigger
                aria-label={translate('markets.tagsFor', { symbol: pair.symbol })}
                title={translate('markets.tagsFor', { symbol: pair.symbol })}
                className="group grid w-11 shrink-0 place-items-center transition-colors hover:bg-abyss-700 data-[state=open]:bg-abyss-700"
            >
                <TagMarks tags={tags} held={held} />
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
                                className={`${LIST_ROW_CLASSES} cursor-pointer rounded text-xs text-ink-200 outline-none data-[highlighted]:bg-abyss-700 data-[highlighted]:text-ink-100`}
                            >
                                <TagSwatch colour={tag.colour} className="size-2.5 shrink-0" />
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


export interface PairMarksProps {
    readonly tags: readonly PairTag[];
    readonly held: ReadonlySet<string>;
    readonly pair: MarketPair;
    readonly translate: Translate;
    readonly onOpen: () => void;
}

/**
 * The marks a row wears, and the press that opens what changes them.
 *
 * The same button the menu's own trigger draws, without the menu behind it. A
 * listing is a hundred and fifty rows and only one menu is ever open, so the
 * other hundred and forty-nine pay for a control nobody is looking at.
 */
export function PairMarks({ tags, held, pair, translate, onOpen }: PairMarksProps): ReactElement {
    return (
        <button
            type="button"
            aria-label={translate('markets.tagsFor', { symbol: pair.symbol })}
            title={translate('markets.tagsFor', { symbol: pair.symbol })}
            // On the click, which is the one event every way of pressing a
            // button produces: a finger, a mouse, and Enter or Space on a
            // focused control. Opened on `pointerdown` to match the menu
            // primitive, it worked under a finger and nowhere else — the
            // browser's compatibility `mousedown` arrived next and the menu,
            // already open, read it as a press outside itself and shut 19ms
            // later, while a keyboard produced no pointer event at all and so
            // could never open it.
            aria-haspopup="menu"
            aria-expanded={false}
            onClick={onOpen}
            className="group grid w-11 shrink-0 place-items-center transition-colors hover:bg-abyss-700"
        >
            <TagMarks tags={tags} held={held} />
        </button>
    );
}

/**
 * What a pair is filed under, drawn as the colours themselves.
 *
 * Cut at three, a pair filed under five tags looked like a pair filed under
 * three, and nothing on the row said otherwise. Overlapped, the same width
 * holds every one of them: the count is read off the depth of the stack, and
 * the ones behind still show the sliver that says what colour they are.
 *
 * One component for both the plain button and the menu's trigger, which is what
 * keeps the row from changing shape under the press that opens the menu.
 */
export function TagMarks({ tags, held }: { readonly tags: readonly PairTag[]; readonly held: ReadonlySet<string> }): ReactElement {
    if (held.size === 0) {
        return <TagGlyph size={14} className="text-ink-500 transition-colors group-hover:text-ink-300" />;
    }

    return (
        <span className="flex items-center">
            {tags.filter((tag) => held.has(tag.id)).map((tag, at) => (
                <span
                    key={tag.id}
                    // Tucked under the one before it, and ringed in the row's
                    // own ground so the edge between two marks stays readable
                    // when their colours are close.
                    className={at === 0 ? '' : '-ml-1'}
                    style={{ zIndex: TOPMOST_MARK - at }}
                >
                    <TagSwatch colour={tag.colour} className="size-2.5 ring-1 ring-abyss-850" />
                </span>
            ))}
        </span>
    );
}
