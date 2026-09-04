import { Collapsible } from 'radix-ui';
import { ChevronRight, Eraser } from 'lucide-react';
import { type ReactElement, useEffect, useRef, useState } from 'react';
import { type AddonLogLine, addonLog, clearAddonLog } from '../addons/addon-console.ts';
import type { Translate } from '../i18n/translator.ts';
import { useStore } from '../react/use-store.ts';

/** How close to the foot still counts as following along. */
const AT_THE_FOOT_PX = 24;

interface AddonConsolePanelProps {
    readonly translate: Translate;
}

/**
 * What the reader's script printed.
 *
 * Shut by default and reopened by hand: a reading that draws is the point, and
 * the console is what a reader opens when the drawing is not what they expected.
 */
export function AddonConsolePanel({ translate }: AddonConsolePanelProps): ReactElement {
    const lines = useStore(addonLog);
    const [isOpen, setIsOpen] = useState(false);

    return (
        <Collapsible.Root open={isOpen} onOpenChange={setIsOpen} className="shrink-0 border-t border-hairline">
            <div className="flex items-center gap-2 px-2">
                <Collapsible.Trigger className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-2 py-2 text-xs text-ink-400 outline-none hover:text-ink-200 focus-visible:ring-2 focus-visible:ring-phosphor/50">
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
                        onClick={clearAddonLog}
                        aria-label={translate('console.clear')}
                        title={translate('console.clear')}
                        className="shrink-0 rounded p-1.5 text-ink-500 outline-none hover:bg-abyss-800 hover:text-ink-200 focus-visible:ring-2 focus-visible:ring-phosphor/50"
                    >
                        <Eraser className="size-3.5" />
                    </button>
                )}
            </div>
            <Collapsible.Content>
                <LogList lines={lines} translate={translate} />
            </Collapsible.Content>
        </Collapsible.Root>
    );
}

interface LogListProps {
    readonly lines: readonly AddonLogLine[];
    readonly translate: Translate;
}

const TONES: Record<AddonLogLine['level'], string> = {
    log: 'text-ink-300',
    warn: 'text-amber',
    error: 'text-ask',
};

function LogList({ lines, translate }: LogListProps): ReactElement {
    const scroller = useRef<HTMLDivElement>(null);
    const wasAtTheFoot = useRef(true);
    // Named only where more than one reading is printing. With a single one the
    // name is on every line and tells the reader nothing they do not know.
    const isShared = new Set(lines.map((line) => line.from)).size > 1;

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
            <p className="px-4 pb-3 text-xs leading-relaxed text-ink-500">
                {translate('console.empty')}
            </p>
        );
    }

    return (
        <div
            ref={scroller}
            onScroll={(event) => {
                const node = event.currentTarget;
                wasAtTheFoot.current
                    = node.scrollHeight - node.scrollTop - node.clientHeight < AT_THE_FOOT_PX;
            }}
            className="max-h-24 overflow-y-auto border-t border-hairline/60 px-3 py-2 lg:max-h-40"
        >
            <ol className="space-y-0.5 font-mono text-[0.6875rem] leading-relaxed">
                {lines.map((line, index) => (
                    <li key={index} className={`flex gap-2 ${TONES[line.level]}`}>
                        {line.repeats > 1 && (
                            <span className="mt-px shrink-0 self-start rounded-full bg-abyss-800 px-1.5 text-[0.625rem] text-ink-400">
                                {line.repeats}
                            </span>
                        )}
                        <span className="min-w-0 whitespace-pre-wrap break-words">
                            {isShared && line.from !== '' && (
                                <span className="mr-1.5 text-ink-500">{line.from}</span>
                            )}
                            {line.text}
                        </span>
                    </li>
                ))}
            </ol>
        </div>
    );
}
