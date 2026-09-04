import {
    type ChangeEvent,
    type ReactElement,
    type RefObject,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import {
    CircleCheck,
    CircleQuestionMark,
    CloudDownload,
    Download,
    Loader,
    Plus,
    Save,
    TriangleAlert,
    Trash2,
    Undo2,
    Upload,
    X,
} from 'lucide-react';
import { CONTROL_BUTTON_CLASSES, CONTROL_RESTING_CLASSES, PANEL_TITLE_CLASSES } from './control-shell.ts';
import { type AddonEditorControls, useAddonEditor } from '../react/use-addon-editor.ts';
import { AddonEditorService } from '../services/addon-editor/addon-editor-service.ts';
import type { Choice } from './choice.ts';
import { AddonConsolePanel } from './addon-console-panel.tsx';
import { ConfirmDialog } from './confirm-dialog.tsx';
import { ImportReadingDialog } from './import-reading-dialog.tsx';
import { ReadingImportService } from '../services/reading-import/reading-import-service.ts';
import { type FileNotice, READING_FILE_PANEL_ID, ReadingFileStrip } from './reading-file-strip.tsx';
import { Divider } from './chart-dock.tsx';
import { Select } from './select.tsx';
import { ADDON_EDITOR_ID } from './panel-ids.ts';
import type { Translate } from '../i18n/translator.ts';
import { useIsViewportAtLeast } from '../react/use-viewport-width.ts';
import { usePanelSize } from '../react/use-panel-size.ts';

import { STARTER_FILES } from './starter-reading.ts';
import { useTranslate } from '../react/use-appearance.ts';

/**
 * What the menu shows while the open reading has never been saved.
 *
 * A word rather than an empty string: the select treats empty as "no value" and
 * falls back to its placeholder, which is a dash that says nothing.
 */
const UNSAVED_CHOICE = 'unsaved';

/** How long the strip's own news stays up before the compiler has the floor. */
const FILE_NOTICE_MS = 5_000;

/** Where the worked examples live, since a reader cannot go and find them. */
const COOKBOOK_URL = 'https://github.com/giovani-freitag/fathom/blob/main/docs/indicator-cookbook.md';

/**
 * The editor this panel runs on.
 *
 * Named here rather than inside the hook, so what orchestrates the editing can
 * be exercised without a compiler and without a browser.
 */
const buildEditor: Parameters<typeof useAddonEditor>[0]['buildEditor'] = (config) => (
    new AddonEditorService(config)
);

interface AddonEditorPanelProps {
    readonly onClose: () => void;
    /** Which saved reading to open on, when the reader picked one. */
    readonly openKey?: string | undefined;
}

/**
 * The editor, beside the chart it draws onto.
 *
 * Beside rather than over: what a reader is checking is what their arithmetic
 * does to the chart, and a panel that covers it hides the answer.
 */
export function AddonEditorPanel({ onClose, openKey }: AddonEditorPanelProps): ReactElement {
    const translate = useTranslate();
    const isWide = useIsViewportAtLeast('lg');
    // Two sizes, one per shape. A width dragged on a desk means nothing to a
    // sheet on a phone, and remembering one as the other would open every
    // phone at the width of somebody's monitor.
    const size = usePanelSize(isWide
        ? { slot: 'fathom.addons.railWidth', growsAlong: 'width', openingRatio: 0.32, smallest: 0.2, largest: 0.6 }
        : { slot: 'fathom.addons.sheetHeight', growsAlong: 'height', openingRatio: 0.6, smallest: 0.25, largest: 0.85 });
    // What the file strip last had to say — a refusal, or a change that worked.
    const [fileSaid, setFileSaid] = useState<FileNotice | null>(null);
    const [isBringingIn, setIsBringingIn] = useState(false);
    const importer = useMemo(() => new ReadingImportService({
        fetch: globalThis.fetch.bind(globalThis),
        // Read through the crypto object because it is absent outside a secure
        // context, where the size the listing gave is the only check left.
        digest: (data) => globalThis.crypto.subtle.digest('SHA-256', data),
    }), []);
    const closeRef = useRef<HTMLButtonElement>(null);
    const consoleRef = useRef<HTMLButtonElement>(null);
    const undoRef = useRef<HTMLButtonElement>(null);
    const returnFocusTo = useRef<Element | null>(null);

    const { mountInto, status, drawFailure, ...editor } = useAddonEditor({
        starter: STARTER_FILES,
        openOn: openKey,
        buildEditor,
        // Monaco eats Tab, so escape is the way out of it. Forward, onto the
        // first control below the editor: everything under it — the console,
        // what a reading printed, the offer to undo — is otherwise unreachable
        // by keyboard, because tabbing on from the toolbar walks back into
        // Monaco and stops there.
        onLeave: () => { consoleRef.current?.focus(); },
    });

    // Put the keyboard back where it was. Unmounting the panel while focus is
    // inside it drops that focus on the document, and a reader who navigates by
    // keyboard has to start again from the top of the page.
    useEffect(() => {
        returnFocusTo.current = document.activeElement;
        return () => { (returnFocusTo.current as HTMLElement | null)?.focus(); };
    }, []);

    // Cleared after a moment: it is news about a change, not the state of the
    // reading, and left up it sits over what the compiler has since said.
    useEffect(() => {
        if (fileSaid === null) {
            return;
        }
        const timer = setTimeout(() => { setFileSaid(null); }, FILE_NOTICE_MS);
        return () => { clearTimeout(timer); };
    }, [fileSaid]);

    // The offer to undo is the only route back from a deletion, so it takes the
    // keyboard rather than waiting below the editor for somebody to find it.
    const discardedName = editor.lastDiscarded?.name ?? null;
    useEffect(() => {
        if (discardedName !== null) {
            undoRef.current?.focus();
        }
    }, [discardedName]);

    return (
        // A sheet from the bottom on a phone, a rail beside the chart on a
        // desk. A phone is held by its lower half and a rail on the right is a
        // regrip away, which is the reasoning the drawing controls already
        // follow — and half a narrow screen is not a chart worth checking
        // against anyway.
        <aside
            id={ADDON_EDITOR_ID}
            aria-label={translate('editor.title')}
            style={{ [isWide ? 'width' : 'height']: `${size.sizePx}px` }}
            className="fixed inset-x-0 bottom-0 z-40 flex min-w-0 flex-col rounded-t-xl border-t border-hairline bg-abyss-850 shadow-2xl shadow-black/80 lg:relative lg:inset-auto lg:h-auto lg:rounded-none lg:border-l lg:border-t-0"
        >
            <PanelGrip size={size} isWide={isWide} translate={translate} />
            <EditorToolbar
                editor={editor}
                translate={translate}
                onClose={onClose}
                closeRef={closeRef}
                onBringIn={() => { setIsBringingIn(true); }}
            />
            <ImportReadingDialog
                isOpen={isBringingIn}
                onOpenChange={setIsBringingIn}
                onLook={(typed) => importer.look(typed)}
                onTake={(found) => importer.take(found)}
                onOpened={editor.openBroughtIn}
            />
            <ReadingFileStrip
                files={editor.files}
                shownFile={editor.shownFile}
                translate={translate}
                onShow={editor.showFile}
                onAdd={editor.addFile}
                onRename={editor.renameFile}
                onRemove={editor.removeFile}
                onSay={setFileSaid}
            />
            {/* A floor under it, because everything else here can grow: the
                console, the file strip and a list of faults together had left
                the editor one line tall on a phone. */}
            <div
                ref={mountInto}
                id={READING_FILE_PANEL_ID}
                role="tabpanel"
                aria-label={translate('files.shown', { path: editor.shownFile })}
                className="min-h-24 flex-1"
            />
            <AddonConsolePanel translate={translate} triggerRef={consoleRef} />

            {/* One region present in every state rather than one per state: a
                live region that is itself added to the tree is not reliably
                read out when it appears. */}
            <div role="status" className="shrink-0">
                {fileSaid !== null
                    ? (fileSaid.kind === 'refused'
                        ? <FaultList translate={translate} lines={[fileSaid.text]} />
                        : (
                            <footer className="border-t border-hairline px-4 py-2.5 text-xs text-ink-300">
                                {fileSaid.text}
                            </footer>
                        ))
                    : editor.lastDiscarded === null
                        ? <EditorStatusLine status={status} drawFailure={drawFailure} translate={translate} />
                        : (
                            <footer className="flex items-center gap-3 border-t border-hairline px-4 py-2.5 text-xs text-ink-300">
                                <span className="min-w-0 flex-1 truncate">
                                    {translate(
                                        editor.lastDiscarded.wasDeleted ? 'indicators.removed' : 'editor.replaced',
                                        { name: editor.lastDiscarded.name },
                                    )}
                                </span>
                                <button
                                    ref={undoRef}
                                    type="button"
                                    onClick={editor.undoDiscard}
                                    className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold text-phosphor outline-none hover:bg-phosphor/12 focus-visible:ring-2 focus-visible:ring-phosphor"
                                >
                                    <Undo2 className="size-3.5" />
                                    {translate('indicators.undo')}
                                </button>
                            </footer>
                        )}
            </div>
        </aside>
    );
}

interface PanelGripProps {
    readonly size: ReturnType<typeof usePanelSize>;
    readonly isWide: boolean;
    readonly translate: Translate;
}

/**
 * The edge a reader drags to make the panel bigger.
 *
 * On the side the panel is not anchored to, which is the left of a rail and the
 * top of a sheet. Double-pressing it puts the size back, because a panel
 * dragged somewhere silly is otherwise a panel to be dragged back by hand.
 */
function PanelGrip({ size, isWide, translate }: PanelGripProps): ReactElement {
    return (
        <div
            role="separator"
            tabIndex={0}
            aria-label={translate('editor.resize')}
            aria-orientation={isWide ? 'vertical' : 'horizontal'}
            aria-valuenow={Math.round(size.sizePx)}
            aria-valuemin={Math.round(size.smallestPx)}
            aria-valuemax={Math.round(size.largestPx)}
            // Said in words as well, because a bare figure read out as
            // "separator, 614" tells a reader nothing about what it is 614 of.
            aria-valuetext={translate(isWide ? 'editor.wide' : 'editor.tall', {
                share: String(size.sharePercent),
            })}
            onPointerDown={size.onGripDown}
            onKeyDown={size.onGripKey}
            onDoubleClick={size.reset}
            className={`group absolute z-10 flex touch-none items-center justify-center outline-none focus-visible:ring-1 focus-visible:ring-phosphor ${
                isWide
                    ? 'inset-y-0 -left-1 w-2 cursor-col-resize'
                    : 'inset-x-0 -top-1 h-4 cursor-row-resize'
            }`}
        >
            {/* Visible only on a sheet, where a reader has to be told it can be
                dragged. A rail's edge is where a pointer already goes. */}
            <span
                className={`rounded-full transition-colors ${
                    isWide
                        ? `h-10 w-0.5 ${size.isDragging ? 'bg-phosphor/60' : 'bg-transparent group-hover:bg-hairline-bright group-focus-visible:bg-hairline-bright'}`
                        : `h-1 w-10 ${size.isDragging ? 'bg-phosphor/60' : 'bg-hairline-bright'}`
                }`}
            />
        </div>
    );
}

interface EditorToolbarProps {
    readonly editor: Omit<AddonEditorControls, 'mountInto' | 'status' | 'drawFailure'>;
    readonly translate: Translate;
    readonly onClose: () => void;
    readonly closeRef: RefObject<HTMLButtonElement | null>;
    /** Opens the way in from a repository or a package. */
    readonly onBringIn: () => void;
}

function EditorToolbar({ editor, translate, onClose, closeRef, onBringIn }: EditorToolbarProps): ReactElement {
    const fileRef = useRef<HTMLInputElement>(null);
    const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
    const { importFile } = editor;

    const handleFileChosen = useCallback((event: ChangeEvent<HTMLInputElement>): void => {
        const file = event.target.files?.[0];
        if (file !== undefined) {
            void importFile(file);
        }
        event.target.value = '';
    }, [importFile]);

    // A reading never saved is a choice of its own rather than an absent value:
    // bound to the open key alone, the menu showed a dash the moment a reader
    // started a new one, which says nothing about anything.
    const saved: readonly Choice[] = [
        { value: UNSAVED_CHOICE, label: translate('editor.unsavedChoice') },
        ...editor.saved.map((one) => ({ value: one.key, label: one.name })),
    ];

    return (
        <header className="shrink-0 border-b border-hairline">
            {/* The panel's own title row, laid out as every other panel's is:
                what this is on the left, what closes it on the right. */}
            <div className="flex items-center gap-2 px-4 py-3">
                <input
                    type="text"
                    name="readingName"
                    aria-label={translate('editor.name')}
                    value={editor.name}
                    onChange={(event) => { editor.rename(event.target.value); }}
                    className={`min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 outline-none transition-colors hover:border-hairline focus-visible:ring-2 focus-visible:ring-phosphor ${PANEL_TITLE_CLASSES}`}
                />
                {editor.isUnsaved && (
                    <span className="shrink-0 text-[11px] text-ink-500">
                        {translate('editor.unsaved')}
                    </span>
                )}
                {editor.isRunning && <Loader className="size-4 shrink-0 animate-spin text-ink-500" />}
                <PanelAction label={translate('editor.close')} onPress={onClose} actionRef={closeRef}>
                    <X className="size-4" />
                </PanelAction>
            </div>

            {/* Grouped rather than spread: what changes the shelf, what moves a
                reading in or out of the page, and the one that destroys work. */}
            <div className="flex items-center gap-1 px-4 pb-3">
                <PanelAction label={translate('editor.save')} onPress={() => { void editor.save(); }}>
                    <Save className="size-4" />
                </PanelAction>
                <PanelAction label={translate('editor.new')} onPress={editor.startAnew}>
                    <Plus className="size-4" />
                </PanelAction>

                <Divider />
                <div className="min-w-0 flex-1">
                    <Select
                        value={editor.openKey ?? UNSAVED_CHOICE}
                        choices={saved}
                        onSelect={(key) => {
                            if (key !== UNSAVED_CHOICE) {
                                editor.open(key);
                            }
                        }}
                        label={translate('editor.openSaved')}
                    />
                </div>
                <Divider />

                <PanelAction label={translate('editor.export')} onPress={editor.exportFile}>
                    <Download className="size-4" />
                </PanelAction>
                <PanelAction label={translate('editor.import')} onPress={() => { fileRef.current?.click(); }}>
                    <Upload className="size-4" />
                </PanelAction>
                <PanelAction label={translate('import.title')} onPress={onBringIn}>
                    <CloudDownload className="size-4" />
                </PanelAction>
                <input
                    ref={fileRef}
                    type="file"
                    accept=".ts,.tsx,.json,text/plain"
                    className="hidden"
                    onChange={handleFileChosen}
                />
                <a
                    href={COOKBOOK_URL}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={translate('editor.help')}
                    title={translate('editor.help')}
                    className={`${CONTROL_BUTTON_CLASSES} ${CONTROL_RESTING_CLASSES} outline-none focus-visible:ring-2 focus-visible:ring-phosphor`}
                >
                    <CircleQuestionMark className="size-4" />
                </a>

                <Divider />
                <PanelAction
                    label={translate('editor.delete')}
                    onPress={() => { setIsConfirmingDelete(true); }}
                    isDangerous
                >
                    <Trash2 className="size-4" />
                </PanelAction>
                <ConfirmDialog
                    isOpen={isConfirmingDelete}
                    onOpenChange={setIsConfirmingDelete}
                    title={translate('editor.deleteTitle')}
                    body={translate('editor.deleteBody', { name: editor.name })}
                    confirmLabel={translate('editor.deleteConfirm')}
                    onConfirm={editor.remove}
                />
            </div>
        </header>
    );
}

interface PanelActionProps {
    readonly label: string;
    readonly onPress: () => void;
    readonly isDangerous?: boolean;
    readonly actionRef?: RefObject<HTMLButtonElement | null>;
    readonly children: ReactElement;
}

/**
 * A glyph a reader presses inside this panel.
 *
 * The shell's own button at the shell's own height: a row of thirty-six pixel
 * glyphs beside a forty pixel select is what `control-shell.ts` was written to
 * stop happening again.
 */
function PanelAction({ label, onPress, isDangerous = false, actionRef, children }: PanelActionProps): ReactElement {
    // Red at rest, not on hover. The one control here that destroys work read
    // as the same colour as save until the pointer was already over it.
    const tone = isDangerous
        ? 'text-ask hover:bg-ask/12 hover:text-ask'
        : CONTROL_RESTING_CLASSES;

    return (
        <button
            ref={actionRef}
            type="button"
            aria-label={label}
            title={label}
            onClick={onPress}
            className={`${CONTROL_BUTTON_CLASSES} outline-none focus-visible:ring-2 focus-visible:ring-phosphor ${tone}`}
        >
            {children}
        </button>
    );
}

interface EditorStatusLineProps {
    readonly status: AddonEditorControls['status'];
    readonly drawFailure: string | null;
    readonly translate: Translate;
}

function EditorStatusLine({ status, drawFailure, translate }: EditorStatusLineProps): ReactElement {
    // A reading that built and then threw while the chart drew it: the compiler
    // saw nothing wrong, so this is the only place it can be said.
    if (drawFailure !== null) {
        return <FaultList translate={translate} lines={[translate('editor.threw', { message: drawFailure })]} />;
    }

    if (status === null) {
        return (
            <footer className="border-t border-hairline px-4 py-2.5 text-xs text-ink-500">
                {translate('editor.starting')}
            </footer>
        );
    }

    if (status.kind === 'ready') {
        return (
            <footer className="flex items-center gap-2 border-t border-hairline px-4 py-2.5 text-xs text-phosphor">
                <CircleCheck className="size-3.5 shrink-0" />
                <span className="truncate">
                    {translate('editor.drawing', { name: status.label })}
                </span>
            </footer>
        );
    }

    return (
        <FaultList
            translate={translate}
            lines={status.kind === 'broken'
                ? [status.message]
                : status.faults.map((one) => translate('editor.fault', {
                    line: String(one.line),
                    message: one.message,
                }))}
        />
    );
}

interface FaultListProps {
    readonly lines: readonly string[];
    readonly translate: Translate;
}

/** Everything wrong with the open reading, in the panel's own foot. */
function FaultList({ lines, translate }: FaultListProps): ReactElement {
    return (
        // Focusable because it scrolls: a list of faults longer than the box is
        // otherwise reachable by wheel alone.
        <footer
            tabIndex={0}
            // A region rather than a bare footer: inside an aside this maps to
            // nothing, where a label is prohibited and goes unread — on the one
            // element here whose whole purpose is to be focused and read.
            role="region"
            aria-label={translate('editor.faults')}
            className="max-h-20 overflow-y-auto border-t border-hairline px-4 py-2.5 text-xs text-ask outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-phosphor lg:max-h-32"
        >
            <div className="flex items-start gap-2">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                <ul className="min-w-0 space-y-1">
                    {lines.map((line) => <li key={line} className="break-words">{line}</li>)}
                </ul>
            </div>
        </footer>
    );
}
