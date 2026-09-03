import { type ChangeEvent, type ReactElement, type RefObject, useCallback, useEffect, useRef } from 'react';
import { CircleCheck, Download, Loader, Plus, Save, TriangleAlert, Trash2, Undo2, Upload, X } from 'lucide-react';
import { CONTROL_BUTTON_CLASSES, CONTROL_RESTING_CLASSES } from './control-shell.ts';
import { type AddonEditorControls, useAddonEditor } from '../react/use-addon-editor.ts';
import { AddonEditorService } from '../services/addon-editor/addon-editor-service.ts';
import type { Choice } from './choice.ts';
import { Divider } from './chart-dock.tsx';
import { Select } from './select.tsx';
import { ADDON_EDITOR_ID } from './panel-ids.ts';
import type { Translate } from '../i18n/translator.ts';
import { useTranslate } from '../react/use-appearance.ts';

/** What a reader with an empty shelf opens on: a whole, working reading. */
export const STARTER_SOURCE = `// This is yours to change. It is already running, and every edit redraws the
// chart beside it. Nothing here leaves this browser.
import { Params, Plot, readSetting } from 'fathom';
import type { Indicator, IndicatorInput, IndicatorSettings, PlanDraft, SourceRequest } from 'fathom';

const PERIOD = Params.integer('periodBars')
    .called('Period')
    .between(2, 400)
    .startingAt(20);

export default class MyMean implements Indicator {
    // What the chart calls it, in the legend and in the layer list.
    readonly label = 'My mean';
    readonly about = 'The mean of the close, written in the page';
    readonly parameters = [PERIOD];

    // Everything besides the drawn bars this reads, for the chart to fetch.
    resolveSources(settings: IndicatorSettings): SourceRequest {
        return { warmupBars: readSetting(settings, PERIOD) };
    }

    compute(input: IndicatorInput): PlanDraft {
        const bars = input.bars.bars;
        const periodBars = readSetting(input.settings, PERIOD);
        const value = bars.map((_bar, index) => {
            if (index < periodBars - 1) {
                // NaN breaks the line rather than drawing a mean of fewer bars
                // than the reader asked for.
                return Number.NaN;
            }
            let total = 0;
            for (let step = 0; step < periodBars; step += 1) {
                total += bars[index - step]!.closePrice;
            }
            return total / periodBars;
        });

        // The colour comes from the layer list, not from here.
        return Plot.over(input.bars)
            .line(value, 'My mean')
            .overThePrice();
    }
}
`;

/** What the menu shows while the open reading has never been saved. */
const UNSAVED_CHOICE = '';

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
    const closeRef = useRef<HTMLButtonElement>(null);
    const undoRef = useRef<HTMLButtonElement>(null);
    const returnFocusTo = useRef<Element | null>(null);

    const { mountInto, status, drawFailure, ...editor } = useAddonEditor({
        starter: STARTER_SOURCE,
        openOn: openKey,
        buildEditor,
        // Monaco eats Tab, so escape is the way out of it. It lands on the one
        // control that is always there, from which the rest is a Tab away.
        onLeave: () => { closeRef.current?.focus(); },
    });

    // Put the keyboard back where it was. Unmounting the panel while focus is
    // inside it drops that focus on the document, and a reader who navigates by
    // keyboard has to start again from the top of the page.
    useEffect(() => {
        returnFocusTo.current = document.activeElement;
        return () => { (returnFocusTo.current as HTMLElement | null)?.focus(); };
    }, []);

    // The offer to undo is the only route back from a deletion, so it takes the
    // keyboard rather than waiting below the editor for somebody to find it.
    const removedName = editor.lastRemoved?.name ?? null;
    useEffect(() => {
        if (removedName !== null) {
            undoRef.current?.focus();
        }
    }, [removedName]);

    return (
        <aside
            id={ADDON_EDITOR_ID}
            aria-label={translate('editor.title')}
            className="flex w-full min-w-0 max-w-[45%] flex-col border-l border-hairline bg-abyss-850 shadow-2xl shadow-black/80 md:w-[38rem]"
        >
            <EditorToolbar editor={editor} translate={translate} onClose={onClose} closeRef={closeRef} />
            <div ref={mountInto} className="min-h-0 flex-1" />

            {/* One region present in every state rather than one per state: a
                live region that is itself added to the tree is not reliably
                read out when it appears. */}
            <div role="status" className="shrink-0">
                {editor.lastRemoved === null
                    ? <EditorStatusLine status={status} drawFailure={drawFailure} translate={translate} />
                    : (
                        <footer className="flex items-center gap-3 border-t border-hairline px-4 py-2.5 text-xs text-ink-300">
                            <span className="min-w-0 flex-1 truncate">
                                {translate('indicators.removed', { name: editor.lastRemoved.name })}
                            </span>
                            <button
                                ref={undoRef}
                                type="button"
                                onClick={editor.undoRemoval}
                                className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold text-phosphor outline-none hover:bg-phosphor/12 focus-visible:ring-2 focus-visible:ring-phosphor/50"
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

interface EditorToolbarProps {
    readonly editor: Omit<AddonEditorControls, 'mountInto' | 'status' | 'drawFailure'>;
    readonly translate: Translate;
    readonly onClose: () => void;
    readonly closeRef: RefObject<HTMLButtonElement | null>;
}

function EditorToolbar({ editor, translate, onClose, closeRef }: EditorToolbarProps): ReactElement {
    const fileRef = useRef<HTMLInputElement>(null);
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
                    className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm font-semibold tracking-wide text-ink-100 outline-none transition-colors hover:border-hairline focus-visible:ring-2 focus-visible:ring-phosphor/50"
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
                <input
                    ref={fileRef}
                    type="file"
                    accept=".ts,.js,text/plain"
                    className="hidden"
                    onChange={handleFileChosen}
                />
                <Divider />
                <PanelAction label={translate('editor.delete')} onPress={editor.remove} isDangerous>
                    <Trash2 className="size-4" />
                </PanelAction>
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
            className={`${CONTROL_BUTTON_CLASSES} outline-none focus-visible:ring-2 focus-visible:ring-phosphor/50 ${tone}`}
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
            aria-label={translate('editor.faults')}
            className="max-h-32 overflow-y-auto border-t border-hairline px-4 py-2.5 text-xs text-ask outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-phosphor/50"
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
