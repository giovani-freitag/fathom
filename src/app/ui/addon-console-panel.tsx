import { Collapsible } from 'radix-ui';
import { ChevronRight, Eraser } from 'lucide-react';
import { type ReactElement, type RefObject, useEffect, useRef, useState } from 'react';
import { type AddonLogLine, addonLog, clearAddonLog } from '../addons/addon-console.ts';
import type { TranslationKey } from '../i18n/dictionaries/en.ts';
import type { Translate } from '../i18n/translator.ts';
import { useStore } from '../react/use-store.ts';
import { namesTheSource } from './console-attribution.ts';

/** How close to the foot still counts as following along. */
const AT_THE_FOOT_PX = 24;

interface AddonConsolePanelProps {
    readonly translate: Translate;
    /** What the reading in the editor calls itself, so its own lines stay bare. */
    readonly openName: string;
    /** Where the keyboard lands on leaving the editor, which sits above this. */
    readonly triggerRef?: RefObject<HTMLButtonElement | null>;
}

/**
 * What the reader's script printed.
 *
 * Shut by default and reopened by hand: a reading that draws is the point, and
 * the console is what a reader opens when the drawing is not what they expected.
 */
export function AddonConsolePanel({ translate, openName, triggerRef }: AddonConsolePanelProps): ReactElement {
    const lines = useStore(addonLog);
    const [isOpen, setIsOpen] = useState(false);
    const ownTrigger = useRef<HTMLButtonElement>(null);
    const trigger = triggerRef ?? ownTrigger;

    return (
        <Collapsible.Root open={isOpen} onOpenChange={setIsOpen} className="shrink-0 border-t border-hairline">
            <div className="flex items-center gap-2 px-2">
                <Collapsible.Trigger ref={trigger} className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-2 py-2 text-xs text-ink-400 outline-none hover:text-ink-200 focus-visible:ring-2 focus-visible:ring-phosphor">
                    <ChevronRight
                        className={`size-3.5 shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                    />
                    <span className="truncate">{translate('console.title')}</span>
                    {lines.length > 0 && (
                        <span className="shrink-0 rounded-full bg-abyss-800 px-1.5 py-0.5 font-mono text-[0.625rem] text-ink-300">
                            {lines.length}
                        </span>
                    )}
                </Collapsible.Trigger>
                {lines.length > 0 && (
                    <button
                        type="button"
                        // Back to the trigger, because pressing this takes the
                        // last line away and this button with it: focus was
                        // landing on the document with nothing to say where.
                        onClick={() => { clearAddonLog(); trigger.current?.focus(); }}
                        aria-label={translate('console.clear')}
                        title={translate('console.clear')}
                        className="shrink-0 rounded p-1.5 text-ink-500 outline-none hover:bg-abyss-800 hover:text-ink-200 focus-visible:ring-2 focus-visible:ring-phosphor"
                    >
                        <Eraser className="size-3.5" />
                    </button>
                )}
            </div>
            <Collapsible.Content>
                <LogList lines={lines} openName={openName} translate={translate} />
            </Collapsible.Content>
        </Collapsible.Root>
    );
}

interface LogListProps {
    readonly lines: readonly AddonLogLine[];
    readonly openName: string;
    readonly translate: Translate;
}

/**
 * How a line says which kind it is.
 *
 * A mark rather than the colour of the words: colour alone says nothing to a
 * screen reader, and amber at eleven pixels is not legible against the light
 * ground anyway. The words stay in the one colour that reads everywhere.
 */
const MARKS = {
    log: { tone: 'text-ink-600', said: 'console.printed' },
    warn: { tone: 'text-amber', said: 'console.warned' },
    error: { tone: 'text-ask', said: 'console.failed' },
} as const satisfies Record<AddonLogLine['level'], { readonly tone: string; readonly said: TranslationKey }>;

function LogList({ lines, openName, translate }: LogListProps): ReactElement {
    const scroller = useRef<HTMLDivElement>(null);
    const wasAtTheFoot = useRef(true);
    const isShared = namesTheSource(lines, openName);

    // Kept at the foot only for a reader who was already there. Scrolling back
    // to read a line and being dragged away from it on the next redraw is the
    // one thing a console must not do.
    useEffect(() => {
        const node = scroller.current;
        if (node !== null && wasAtTheFoot.current) {
            node.scrollTop = node.scrollHeight;
        }
    }, [lines]);

    if (lines.length === 0) {
        return (
            <p className="px-4 pb-3 text-xs leading-relaxed text-ink-400">
                {translate('console.empty')}
            </p>
        );
    }

    return (
        <div
            ref={scroller}
            tabIndex={0}
            role="log"
            aria-label={translate('console.title')}
            onScroll={(event) => {
                const node = event.currentTarget;
                wasAtTheFoot.current
                    = node.scrollHeight - node.scrollTop - node.clientHeight < AT_THE_FOOT_PX;
            }}
            className="max-h-24 overflow-y-auto border-t border-hairline/60 px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-phosphor lg:max-h-40"
        >
            <ol className="space-y-0.5 font-mono text-[0.6875rem] leading-relaxed">
                {lines.map((line, index) => (
                    <li key={index} className="flex gap-2 text-ink-300">
                        <span
                            aria-label={translate(MARKS[line.level].said)}
                            className={`mt-px shrink-0 select-none ${MARKS[line.level].tone}`}
                        >
                            {line.level === 'log' ? '·' : '!'}
                        </span>
                        {line.repeats > 1 && (
                            <span className="mt-px shrink-0 self-start rounded-full bg-abyss-800 px-1.5 text-[0.625rem] text-ink-400">
                                {line.repeats}
                            </span>
                        )}
                        <span className="min-w-0 whitespace-pre-wrap break-words">
                            {isShared && line.from !== '' && (
                                <span className="mr-1.5 text-ink-400">{line.from}</span>
                            )}
                            {line.text}
                        </span>
                    </li>
                ))}
            </ol>
        </div>
    );
}
