import { type ChangeEvent, type ReactElement, useRef } from 'react';
import { CircleCheck, CircleX, Download, Loader, Plus, Save, Trash2, Undo2, Upload, X } from 'lucide-react';
import { type AddonEditorControls, type SourceEditor, useAddonEditor } from '../react/use-addon-editor.ts';
import { AddonEditorService } from '../services/addon-editor/addon-editor-service.ts';
import type { Choice } from './choice.ts';
import { Divider } from './chart-dock.tsx';
import { Select } from './select.tsx';
import type { Translate } from '../i18n/translator.ts';
import { useTranslate } from '../react/use-appearance.ts';

/** What a reader with an empty shelf opens on: a whole, working reading. */
export const STARTER_SOURCE = `import { Params, Plot, readSetting } from 'fathom';
import type { Indicator, IndicatorInput, IndicatorSettings, PlanDraft, SourceRequest } from 'fathom';

const PERIOD = Params.integer('periodBars')
    .called('Period')
    .between(2, 400)
    .startingAt(20);

export default class MyMean implements Indicator {
    readonly label = 'My mean';
    readonly about = 'The mean of the close, written in the page';
    readonly parameters = [PERIOD];

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

        return Plot.over(input.bars)
            .line(value, 'My mean')
            .in('amber')
            .overThePrice();
    }
}
`;

/**
 * The editor this panel runs on.
 *
 * Named here rather than inside the hook, so what orchestrates the editing can
 * be exercised without a compiler and without a browser.
 */
function buildEditor(config: { onChange: () => void; theme: 'dark' | 'light' }): SourceEditor {
    return new AddonEditorService(config);
}

/** What the menu shows while the open reading has never been saved. */
const UNSAVED_CHOICE = '';

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
    const { mountInto, status, drawFailure, ...editor } = useAddonEditor({
        starter: STARTER_SOURCE,
        openOn: openKey,
        buildEditor,
    });

    // Capped as a share of the row rather than only in rems: what a reader is
    // checking is what their arithmetic does to the chart, and on a laptop a
    // fixed 38rem left the chart too narrow to read.
    return (
        <aside className="flex w-full min-w-0 max-w-[45%] flex-col border-l border-hairline bg-abyss-850 shadow-2xl shadow-black/80 md:w-[38rem]">
            <EditorToolbar editor={editor} translate={translate} onClose={onClose} />
            <div ref={mountInto} className="min-h-0 flex-1" />
            {editor.lastRemoved === null
                ? <EditorStatusLine status={status} drawFailure={drawFailure} translate={translate} />
                : (
                    <footer className="flex shrink-0 items-center gap-3 border-t border-hairline px-4 py-2.5 text-xs text-ink-300">
                        <span className="min-w-0 flex-1 truncate">
                            {translate('indicators.removed', { name: editor.lastRemoved.name })}
                        </span>
                        <button
                            type="button"
                            onClick={editor.undoRemoval}
                            className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold text-phosphor hover:bg-phosphor/12"
                        >
                            <Undo2 className="size-3.5" />
                            {translate('indicators.undo')}
                        </button>
                    </footer>
                )}
        </aside>
    );
}

interface EditorToolbarProps {
    readonly editor: Omit<AddonEditorControls, 'mountInto' | 'status' | 'drawFailure'>;
    readonly translate: Translate;
    readonly onClose: () => void;
}

function EditorToolbar({ editor, translate, onClose }: EditorToolbarProps): ReactElement {
    const fileRef = useRef<HTMLInputElement>(null);

    const handleFileChosen = (event: ChangeEvent<HTMLInputElement>): void => {
        const file = event.target.files?.[0];
        if (file !== undefined) {
            void editor.importFile(file);
        }
        event.target.value = '';
    };

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
                    className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm font-semibold tracking-wide text-ink-100 outline-none transition-colors hover:border-hairline focus:border-phosphor/60 focus:bg-abyss-900"
                />
                {editor.isUnsaved && (
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-amber">
                        {translate('editor.unsaved')}
                    </span>
                )}
                {editor.isRunning && <Loader className="size-3.5 shrink-0 animate-spin text-ink-500" />}
                <PanelAction label={translate('editor.close')} onPress={onClose}>
                    <X className="size-4" />
                </PanelAction>
            </div>

            {/* Grouped rather than spread: what changes the shelf, what moves a
                reading in or out of the page, and the one that destroys work. */}
            <div className="flex items-center gap-1 px-3 pb-2">
                <PanelAction label={translate('editor.save')} onPress={() => { void editor.save(); }}>
                    <Save className="size-4" />
                </PanelAction>
                <PanelAction label={translate('editor.new')} onPress={editor.startAnew}>
                    <Plus className="size-4" />
                </PanelAction>

                {saved.length > 0 && (
                    <>
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
                    </>
                )}
                {saved.length === 0 && <span className="flex-1" />}

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
    readonly children: ReactElement;
}

/**
 * A glyph a reader presses inside a panel.
 *
 * The panel's own shape rather than the chart's: a bordered chip forty pixels
 * tall is what sits in the bar over the chart, and a row of them inside a card
 * reads as a second toolbar that wandered in.
 */
function PanelAction({ label, onPress, isDangerous = false, children }: PanelActionProps): ReactElement {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            onClick={onPress}
            className={`inline-flex size-9 shrink-0 items-center justify-center rounded-md text-ink-500 transition-colors hover:bg-abyss-700 ${
                isDangerous ? 'hover:text-ask' : 'hover:text-ink-100'
            }`}
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
        return <FaultList lines={[`${translate('editor.threw')} ${drawFailure}`]} />;
    }

    if (status === null) {
        return (
            <footer className="shrink-0 border-t border-hairline px-4 py-2.5 text-xs text-ink-500">
                {translate('editor.starting')}
            </footer>
        );
    }

    if (status.kind === 'ready') {
        return (
            <footer className="flex shrink-0 items-center gap-2 border-t border-hairline px-4 py-2.5 text-xs text-phosphor">
                <CircleCheck className="size-3.5 shrink-0" />
                <span className="truncate">
                    {translate('editor.drawing', { name: status.label })}
                </span>
            </footer>
        );
    }

    return (
        <FaultList
            lines={status.kind === 'broken'
                ? [status.message]
                : status.faults.map((one) => `${translate('editor.line')} ${one.line}: ${one.message}`)}
        />
    );
}

/** Everything wrong with the open reading, in the panel's own foot. */
function FaultList({ lines }: { readonly lines: readonly string[] }): ReactElement {
    return (
        <footer className="max-h-32 shrink-0 overflow-y-auto border-t border-hairline px-4 py-2.5 text-xs text-ask">
            <div className="flex items-start gap-2">
                <CircleX className="mt-0.5 size-3.5 shrink-0" />
                <ul className="min-w-0 space-y-1">
                    {lines.map((line) => <li key={line} className="break-words">{line}</li>)}
                </ul>
            </div>
        </footer>
    );
}
