import type { ChartState } from '../core/chart-controller.ts';
import { SlidersHorizontal, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import type { ReactElement } from 'react';
import { AboutPanel } from './about-panel.tsx';
import type { IndicatorControls } from '../react/use-indicators.ts';
import { LayerAccordion } from './indicators/layer-accordion.tsx';
import { AppearanceControls } from './appearance-controls.tsx';
import { ControlButton } from './control-button.tsx';
import { useAppearance, useTranslate } from '../react/use-appearance.ts';
import { useKernel } from '../react/kernel-context.ts';

interface SettingsDrawerProps {
    readonly state: ChartState;
    readonly controls: IndicatorControls;
    readonly isOpen: boolean;
    readonly onOpenChange: (isOpen: boolean) => void;
    /** The layer to open onto, or null to open onto nothing. */
    readonly expandedLayer: string | null;
    readonly onExpandedLayerChange: (instanceId: string | null) => void;
}

/**
 * Everything a reader can change, in one drawer.
 */
export function SettingsDrawer({
    state,
    controls,
    isOpen,
    onOpenChange,
    expandedLayer,
    onExpandedLayerChange,
}: SettingsDrawerProps): ReactElement {
    const kernel = useKernel();
    const translate = useTranslate();
    const appearance = useAppearance();

    return (
        <Dialog.Root open={isOpen} onOpenChange={onOpenChange}>
            <Dialog.Trigger asChild>
                <ControlButton aria-label={translate('settings.open')}>
                    <SlidersHorizontal className="size-4" />
                </ControlButton>
            </Dialog.Trigger>

            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-40 bg-black/25" />
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
                            {translate('indicators.title')}
                        </span>
                        <LayerAccordion
                            controls={controls}
                            state={state}
                            expanded={expandedLayer}
                            onExpandedChange={onExpandedLayerChange}
                        />

                        {/*
                            Its own section, present whether or not the book is
                            being drawn. Kept inside the layer, taking the book
                            off the chart would take the only control over a
                            collector that goes on writing to disk — and an
                            order book that stopped being recorded cannot be
                            recovered afterwards.
                        */}
                        <span className="block border-t border-hairline pt-5 text-xs text-ink-300">
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

                        <AboutPanel translate={translate} />
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
