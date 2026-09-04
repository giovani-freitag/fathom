import { type KeyboardEvent, type ReactElement, useEffect, useRef, useState } from 'react';
import { FilePlus2, X } from 'lucide-react';
import { CONTROL_CHOSEN_CLASSES, CONTROL_OFFERED_CLASSES } from './control-shell.ts';
import { ENTRY_FILE } from '../../shared/core/reading-files.ts';
import type { Translate } from '../i18n/translator.ts';

/** What the chosen file's tab points at, which is where the editor is. */
export const READING_FILE_PANEL_ID = 'reading-file-panel';

interface ReadingFileStripProps {
    readonly files: readonly string[];
    readonly shownFile: string;
    readonly translate: Translate;
    readonly onShow: (path: string) => void;
    /** Both answer with what they refused over, or null. */
    readonly onAdd: (path: string) => string | null;
    readonly onRename: (from: string, to: string) => string | null;
    readonly onRemove: (path: string) => void;
    /** What to say about the change, refusal or otherwise. Null says nothing. */
    readonly onSay: (said: FileNotice | null) => void;
}

/** What the strip has to say about the last thing it was asked to do. */
export interface FileNotice {
    readonly kind: 'refused' | 'done';
    readonly text: string;
}

/**
 * The files a reading is written across.
 *
 * A strip rather than a tree down the side: the panel shares its width with the
 * chart it is about, and a reading of three or four files spends that width
 * better on the code than on the shape of a folder.
 */
export function ReadingFileStrip({
    files,
    shownFile,
    translate,
    onShow,
    onAdd,
    onRename,
    onRemove,
    onSay,
}: ReadingFileStripProps): ReactElement {
    const [typing, setTyping] = useState<{ readonly renaming: string | null } | null>(null);
    // Counted rather than held as state, because what it points at is a node
    // that does not exist yet: the effect runs once the strip has been redrawn.
    const [settled, setSettled] = useState(0);
    const wanting = useRef<string | null>(null);
    const strip = useRef<HTMLDivElement>(null);
    const addButton = useRef<HTMLButtonElement>(null);

    // Onto the file it just made, or back to where the naming started. Left to
    // itself, the field it was typed in unmounts and the keyboard lands on the
    // document, with nothing to say where it went.
    useEffect(() => {
        const path = wanting.current;
        if (path === null) {
            return;
        }
        wanting.current = null;
        const chip = strip.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`);
        (chip ?? addButton.current)?.focus();
    }, [settled]);

    const focusAfter = (path: string): void => {
        wanting.current = path;
        setSettled((held) => held + 1);
    };

    const settle = (typed: string): void => {
        const renaming = typing?.renaming ?? null;
        const wanted = typed.trim();
        setTyping(null);
        if (wanted === '' || wanted === renaming) {
            onSay(null);
            focusAfter(renaming ?? '');
            return;
        }
        const refusal = renaming === null ? onAdd(wanted) : onRename(renaming, wanted);
        // Said either way. A file appearing in a strip is nothing a screen
        // reader notices, so a change that worked was as silent as one refused.
        onSay(refusal === null
            ? { kind: 'done', text: translate(renaming === null ? 'files.added' : 'files.renamed', { path: wanted }) }
            : { kind: 'refused', text: refusal });
        focusAfter(refusal === null ? wanted : renaming ?? '');
    };

    return (
        <div
            ref={strip}
            role="tablist"
            aria-label={translate('files.title')}
            aria-orientation="horizontal"
            // Capped and scrolled: a reading brought in from a repository can
            // be twenty files, and a strip that grows with them takes the
            // panel over before a line of code is read.
            className="flex max-h-24 shrink-0 flex-wrap items-center gap-1 overflow-y-auto border-b border-hairline px-2 py-1.5"
        >
            {files.map((path) => (
                typing?.renaming === path
                    ? <PathField key={path} startingAt={path} translate={translate} onSettle={settle} />
                    : (
                        <FileChip
                            key={path}
                            path={path}
                            isShown={path === shownFile}
                            translate={translate}
                            onShow={() => { onShow(path); }}
                            onRename={() => { onSay(null); setTyping({ renaming: path }); }}
                            onRemove={() => {
                                onRemove(path);
                                onSay({ kind: 'done', text: translate('files.removed', { path }) });
                                focusAfter(ENTRY_FILE);
                            }}
                        />
                    )
            ))}

            {typing?.renaming === null
                ? <PathField startingAt="" translate={translate} onSettle={settle} />
                : (
                    <button
                        ref={addButton}
                        type="button"
                        onClick={() => { onSay(null); setTyping({ renaming: null }); }}
                        aria-label={translate('files.add')}
                        title={translate('files.add')}
                        className="grid size-7 shrink-0 place-items-center rounded-md text-ink-500 outline-none transition-colors hover:bg-abyss-800 hover:text-ink-100 focus-visible:ring-2 focus-visible:ring-phosphor"
                    >
                        <FilePlus2 className="size-3.5" />
                    </button>
                )}
        </div>
    );
}

interface FileChipProps {
    readonly path: string;
    readonly isShown: boolean;
    readonly translate: Translate;
    readonly onShow: () => void;
    readonly onRename: () => void;
    readonly onRemove: () => void;
}

function FileChip({ path, isShown, translate, onShow, onRename, onRemove }: FileChipProps): ReactElement {
    // The entry is what the chart takes the reading out of, so it is the one
    // file a reading cannot be without.
    const isEntry = path === ENTRY_FILE;

    const handleKey = (event: KeyboardEvent<HTMLButtonElement>): void => {
        if (!isEntry && event.key === 'F2') {
            event.preventDefault();
            onRename();
        }
    };

    return (
        <span className="group inline-flex items-center">
            <button
                type="button"
                role="tab"
                aria-selected={isShown}
                aria-controls={READING_FILE_PANEL_ID}
                data-path={path}
                onClick={onShow}
                onDoubleClick={isEntry ? undefined : onRename}
                onKeyDown={handleKey}
                title={isEntry ? translate('files.entry') : translate('files.rename')}
                className={`inline-flex h-7 items-center rounded-md border px-2 font-mono text-[0.6875rem] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-phosphor ${
                    isShown ? CONTROL_CHOSEN_CLASSES : CONTROL_OFFERED_CLASSES
                } ${isEntry ? '' : 'rounded-r-none border-r-0'}`}
            >
                {path}
            </button>
            {!isEntry && (
                <button
                    type="button"
                    onClick={onRemove}
                    aria-label={translate('files.remove', { path })}
                    title={translate('files.remove', { path })}
                    className={`grid h-7 w-6 place-items-center rounded-md rounded-l-none border border-l-0 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-phosphor ${
                        isShown ? CONTROL_CHOSEN_CLASSES : CONTROL_OFFERED_CLASSES
                    } hover:text-ask`}
                >
                    <X className="size-3" />
                </button>
            )}
        </span>
    );
}

interface PathFieldProps {
    readonly startingAt: string;
    readonly translate: Translate;
    readonly onSettle: (typed: string) => void;
}

function PathField({ startingAt, translate, onSettle }: PathFieldProps): ReactElement {
    const [typed, setTyped] = useState(startingAt);

    return (
        <input
            autoFocus
            value={typed}
            onChange={(event) => { setTyped(event.target.value); }}
            onBlur={() => { onSettle(typed); }}
            onKeyDown={(event) => {
                if (event.key === 'Enter') {
                    onSettle(typed);
                }
                if (event.key === 'Escape') {
                    // Stopped here rather than left to bubble: the same key
                    // leaves the editor, and cancelling a name should not.
                    event.stopPropagation();
                    onSettle(startingAt);
                }
            }}
            aria-label={translate('files.name')}
            placeholder={translate('files.example')}
            className="h-7 w-32 rounded-md border border-phosphor/60 bg-abyss-900 px-2 font-mono text-[0.6875rem] text-ink-100 outline-none placeholder:text-ink-500"
        />
    );
}
