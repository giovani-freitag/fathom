import { Dialog } from 'radix-ui';
import { type FormEvent, type ReactElement, useState } from 'react';
import { Loader, TriangleAlert } from 'lucide-react';
import {
    CONTROL_CHIP_CLASSES,
    CONTROL_CHOSEN_CLASSES,
    CONTROL_OFFERED_CLASSES,
    OVERLAY_CLASSES,
    PANEL_TITLE_CLASSES,
} from './control-shell.ts';
import type { FoundReading } from '../services/reading-import/reading-import-service.ts';
import type { ReadingFiles } from '../../shared/core/reading-files.ts';
import type { Translate } from '../i18n/translator.ts';
import { useTranslate } from '../react/use-appearance.ts';

interface ImportReadingDialogProps {
    readonly isOpen: boolean;
    readonly onOpenChange: (isOpen: boolean) => void;
    /** Looks at a spec without fetching any of the code behind it. */
    readonly onLook: (typed: string) => Promise<FoundReading>;
    /** Fetches what a look found, from where that look found it. */
    readonly onTake: (found: FoundReading) => Promise<ReadingFiles>;
    readonly onOpened: (files: ReadingFiles, name: string) => void;
}

type Stage =
    | { readonly kind: 'asking' }
    | { readonly kind: 'looking' }
    | { readonly kind: 'found'; readonly found: FoundReading }
    | { readonly kind: 'refused'; readonly reason: string };

/**
 * Brings a reading in from a repository or a package.
 *
 * In two steps on purpose. What is fetched here is somebody else's code, and it
 * runs in this page the moment it lands — so the reader is shown what they are
 * about to run, and from where, while none of it has arrived yet.
 */
export function ImportReadingDialog({
    isOpen,
    onOpenChange,
    onLook,
    onTake,
    onOpened,
}: ImportReadingDialogProps): ReactElement {
    const translate = useTranslate();
    const [typed, setTyped] = useState('');
    const [stage, setStage] = useState<Stage>({ kind: 'asking' });

    const look = async (event: FormEvent): Promise<void> => {
        event.preventDefault();
        if (stage.kind === 'looking') {
            return;
        }
        setStage({ kind: 'looking' });
        try {
            setStage({ kind: 'found', found: await onLook(typed) });
        } catch (refusal) {
            setStage({ kind: 'refused', reason: describeRefusal(refusal) });
        }
    };

    const take = async (found: FoundReading): Promise<void> => {
        setStage({ kind: 'looking' });
        try {
            const files = await onTake(found);
            onOpenChange(false);
            setTyped('');
            setStage({ kind: 'asking' });
            onOpened(files, found.name);
        } catch (refusal) {
            setStage({ kind: 'refused', reason: describeRefusal(refusal) });
        }
    };

    return (
        <Dialog.Root
            open={isOpen}
            onOpenChange={(next) => {
                onOpenChange(next);
                if (!next) {
                    setStage({ kind: 'asking' });
                }
            }}
        >
            <Dialog.Portal>
                <Dialog.Overlay className={OVERLAY_CLASSES} />
                <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[26rem] max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-hairline bg-abyss-850 p-4 shadow-2xl shadow-black/80">
                    <Dialog.Title className={PANEL_TITLE_CLASSES}>
                        {translate('import.title')}
                    </Dialog.Title>
                    <Dialog.Description className="mt-2 text-xs leading-relaxed text-ink-400">
                        {translate('import.body')}
                    </Dialog.Description>

                    <form onSubmit={(event) => { void look(event); }} className="mt-3 flex gap-2">
                        <input
                            autoFocus
                            value={typed}
                            onChange={(event) => { setTyped(event.target.value); }}
                            aria-label={translate('import.where')}
                            placeholder={translate('import.example')}
                            className="h-9 min-w-0 flex-1 rounded-lg border border-hairline bg-abyss-900 px-3 font-mono text-xs text-ink-100 outline-none transition-colors placeholder:text-ink-500 focus:border-phosphor/60"
                        />
                        {/* Kept enabled while it works, and the press ignored
                            instead: disabling the button under the finger that
                            pressed it drops the keyboard on the document. */}
                        <button
                            type="submit"
                            aria-label={translate('import.look')}
                            aria-busy={stage.kind === 'looking'}
                            className={`${CONTROL_CHIP_CLASSES} h-9 shrink-0 justify-center ${CONTROL_OFFERED_CLASSES}`}
                        >
                            {stage.kind === 'looking'
                                ? <Loader className="size-3.5 animate-spin" />
                                : translate('import.look')}
                        </button>
                    </form>

                    {/* One region in every state, so what it says is read out
                        as it changes: a refusal, and what was found. */}
                    <div role="status">
                        {stage.kind === 'refused' && (
                            <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-ask">
                                <TriangleAlert className="mt-px size-3.5 shrink-0" />
                                <span>{stage.reason}</span>
                            </p>
                        )}

                        {stage.kind === 'found' && (
                            <FoundPanel
                                found={stage.found}
                                translate={translate}
                                onTake={() => { void take(stage.found); }}
                            />
                        )}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

interface FoundPanelProps {
    readonly found: FoundReading;
    readonly translate: Translate;
    readonly onTake: () => void;
}

function FoundPanel({ found, translate, onTake }: FoundPanelProps): ReactElement {
    return (
        <div className="mt-3 rounded-lg border border-hairline bg-abyss-900/60 p-3">
            <p className="font-mono text-[0.6875rem] text-ink-300">{found.from}</p>
            {/* Focusable because it scrolls: a repository of twenty files shows
                five of them, and the rest were reachable by wheel alone —
                inside a dialog that holds the keyboard. */}
            <ul
                tabIndex={0}
                aria-label={translate('import.files')}
                className="mt-2 max-h-28 space-y-0.5 overflow-y-auto rounded font-mono text-[0.6875rem] text-ink-400 outline-none focus-visible:ring-2 focus-visible:ring-phosphor"
            >
                {found.files.map((one) => (
                    <li key={one.path} className="flex justify-between gap-3">
                        <span className="truncate">{one.path}</span>
                        <span className="shrink-0 text-ink-600">{Math.max(1, Math.round(one.bytes / 1024))} kB</span>
                    </li>
                ))}
            </ul>

            {/* Said here rather than in the description above, because this is
                the press that runs it and it is the last chance to say so. The
                caution is carried by the box and the mark, not by the colour of
                the words: this is the sentence in the panel that has to be
                legible, and amber text at eleven pixels is not. */}
            <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber/40 bg-amber/10 p-2.5 text-xs leading-relaxed text-ink-100">
                <TriangleAlert className="mt-px size-3.5 shrink-0 text-amber" />
                <span>{translate('import.runsHere')}</span>
            </p>

            <div className="mt-3 flex justify-end">
                <button
                    type="button"
                    onClick={onTake}
                    className={`${CONTROL_CHIP_CLASSES} h-8 justify-center ${CONTROL_CHOSEN_CLASSES}`}
                >
                    {translate('import.take', { count: String(found.files.length) })}
                </button>
            </div>
        </div>
    );
}

function describeRefusal(refusal: unknown): string {
    return refusal instanceof Error ? refusal.message : String(refusal);
}
