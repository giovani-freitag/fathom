import type { ChartState } from '../core/chart-controller.ts';
import { formatDuration, formatFixed } from '../core/formatting.ts';
import { resolveRecordedSpanMs } from '../core/viewport-policy.ts';
import { SlidersHorizontal, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import type { ReactElement } from 'react';
import { AboutPanel } from './about-panel.tsx';
import { AppearanceControls } from './appearance-controls.tsx';
import { ControlButton } from './control-button.tsx';
import type { RecordingControl } from '../../shared/core/recording-control.ts';
import { RecordingPanel } from './recording-panel.tsx';
import { useAppearance, useTranslate } from '../react/use-appearance.ts';
import { useKernel } from '../react/kernel-context.ts';

interface SettingsDrawerProps {
    readonly state: ChartState;
    /** Absent when the page is its own collector and there is nothing to supervise. */
    readonly recording: RecordingControl | null;
    readonly onContractsChanged: () => void;
}

/**
 * Everything a reader can change, in one drawer.
 */
export function SettingsDrawer({ state, recording, onContractsChanged }: SettingsDrawerProps): ReactElement {
    const kernel = useKernel();
    const translate = useTranslate();
    const appearance = useAppearance();

    return (
        <Dialog.Root>
            <Dialog.Trigger asChild>
                <ControlButton aria-label={translate('settings.open')}>
                    <SlidersHorizontal className="size-4" />
                </ControlButton>
            </Dialog.Trigger>

            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]" />
                {/*
                    A drawer against the right edge, on every size. It is capped
                    to the viewport and scrolls inside: grown past it, the panel
                    would carry its own title and close button off the screen. A
                    strip of the chart stays visible beside it so the reader can
                    see what the controls are changing.
                */}
                <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-[26rem] max-w-[calc(100%-2.5rem)] flex-col border-l border-hairline bg-abyss-850 shadow-2xl shadow-black/80 duration-200 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right">
                    <div className="flex shrink-0 items-center justify-between border-b border-hairline px-4 py-3">
                        <Dialog.Title className="text-sm font-semibold tracking-wide text-ink-100">
                            {translate('settings.title')}
                        </Dialog.Title>
                        <Dialog.Close asChild>
                            <button
                                type="button"
                                aria-label={translate('settings.close')}
                                className="inline-flex size-9 items-center justify-center rounded-md text-ink-500 hover:bg-abyss-700 hover:text-ink-100"
                            >
                                <X className="size-4" />
                            </button>
                        </Dialog.Close>
                    </div>

                    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                        <span className="block text-xs text-ink-300">
                            {translate('settings.appearance')}
                        </span>
                        <AppearanceControls
                            locale={appearance.locale}
                            themeChoice={appearance.themeChoice}
                            resolvedTheme={appearance.resolvedTheme}
                            translate={translate}
                            onSelectLocale={(locale) => { kernel.appearance.selectLocale(locale); }}
                            onSelectTheme={(themeChoice) => { kernel.appearance.selectTheme(themeChoice); }}
                        />

                        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-hairline pt-4 text-[11px]">
                            <dt className="text-ink-500">{translate('settings.recordedSoFar')}</dt>
                            <dd className="numeric text-right text-ink-100">
                                {formatDuration(resolveRecordedSpanMs(state.instruments, state.instrumentSymbol), translate)}
                            </dd>
                            <dt className="text-ink-500">{translate('settings.resolution')}</dt>
                            <dd className="numeric text-right text-ink-300">
                                {translate('settings.perColumn', { value: formatDuration(state.dataset.sampleIntervalMs, translate) })}
                            </dd>
                            <dt className="text-ink-500">{translate('settings.priceBand')}</dt>
                            <dd className="numeric text-right text-ink-300">
                                {translate('settings.perRow', { value: state.dataset.priceBucketSize })}
                            </dd>
                            <dt className="text-ink-500">{translate('settings.columnsLoaded')}</dt>
                            <dd className="numeric text-right text-ink-300">{formatFixed(state.dataset.frames.length, 0)}</dd>
                            <dt className="text-ink-500">{translate('settings.gapsInWindow')}</dt>
                            <dd className="numeric text-right text-ink-300">{formatFixed(state.dataset.gaps.length, 0)}</dd>
                        </dl>

                        {recording === null ? null : (
                            <RecordingPanel
                                recording={recording}
                                onContractsChanged={onContractsChanged}
                                translate={translate}
                            />
                        )}

                        <p className="text-[11px] leading-relaxed text-ink-500">
                            {translate('settings.backfillNote')}
                        </p>

                        <AboutPanel translate={translate} />
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
