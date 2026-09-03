import type { ReactElement } from 'react';
import { CircleCheck, CircleX, Loader, X } from 'lucide-react';
import { useAddonEditor } from '../react/use-addon-editor.ts';
import { useTranslate } from '../react/use-appearance.ts';
import type { Translate } from '../i18n/translator.ts';

/** What a reader with nothing stored opens on: a whole, working reading. */
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

interface AddonEditorPanelProps {
    readonly onClose: () => void;
}

/**
 * The editor, beside the chart it draws onto.
 *
 * Beside rather than over: what a reader is checking is what their arithmetic
 * does to the chart, and a panel that covers it hides the answer.
 */
export function AddonEditorPanel({ onClose }: AddonEditorPanelProps): ReactElement {
    const translate = useTranslate();
    const { hostRef, status, isRunning } = useAddonEditor(STARTER_SOURCE);

    return (
        <aside className="flex w-full min-w-0 flex-col border-l border-abyss-700 bg-abyss-800 md:w-[38rem]">
            <header className="flex items-center gap-2 border-b border-abyss-700 px-3 py-2">
                <h2 className="flex-1 text-xs font-semibold uppercase tracking-wide text-ink-300">
                    {translate('editor.title')}
                </h2>
                {isRunning && <Loader className="size-3.5 animate-spin text-ink-500" />}
                <button
                    type="button"
                    aria-label={translate('editor.close')}
                    onClick={onClose}
                    className="rounded p-1 text-ink-500 transition-colors hover:bg-abyss-700 hover:text-ink-100"
                >
                    <X className="size-4" />
                </button>
            </header>

            <div ref={hostRef} className="min-h-0 flex-1" />

            <EditorStatusLine status={status} translate={translate} />
        </aside>
    );
}

interface EditorStatusLineProps {
    readonly status: ReturnType<typeof useAddonEditor>['status'];
    readonly translate: Translate;
}

function EditorStatusLine({ status, translate }: EditorStatusLineProps): ReactElement {
    if (status === null) {
        return (
            <footer className="border-t border-abyss-700 px-3 py-2 text-xs text-ink-500">
                {translate('editor.starting')}
            </footer>
        );
    }

    if (status.kind === 'ready') {
        return (
            <footer className="flex items-center gap-2 border-t border-abyss-700 px-3 py-2 text-xs text-phosphor">
                <CircleCheck className="size-3.5 shrink-0" />
                <span className="truncate">
                    {translate('editor.drawing').replace('{name}', status.label)}
                </span>
            </footer>
        );
    }

    const lines = status.kind === 'broken'
        ? [status.message]
        : status.faults.map((one) => `Line ${one.line}: ${one.message}`);

    return (
        <footer className="max-h-32 overflow-y-auto border-t border-abyss-700 px-3 py-2 text-xs text-ask">
            <div className="flex items-start gap-2">
                <CircleX className="mt-0.5 size-3.5 shrink-0" />
                <ul className="min-w-0 space-y-1">
                    {lines.map((line) => <li key={line} className="break-words">{line}</li>)}
                </ul>
            </div>
        </footer>
    );
}
