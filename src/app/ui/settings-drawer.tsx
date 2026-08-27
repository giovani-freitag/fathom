import { PanelSection } from './panel-section.tsx';
import { SlidersHorizontal, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { memo, type ReactElement } from 'react';
import { AboutPanel } from './about-panel.tsx';
import type { IndicatorControls } from '../react/use-indicators.ts';
import { LayerAccordion } from './indicators/layer-accordion.tsx';
import { AppearanceControls } from './appearance-controls.tsx';
import { ControlButton } from './control-button.tsx';
import { useAppearance, useTranslate } from '../react/use-appearance.ts';
import { useChartState } from '../react/use-chart-state.ts';
import { useKernel } from '../react/kernel-context.ts';

interface SettingsDrawerProps {
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
function SettingsDrawerShell({
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

                    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                        <PanelSection title={translate('indicators.title')} isDivided={false}>
                            <DrawerLayers
                                controls={controls}
                                expanded={expandedLayer}
                                onExpandedChange={onExpandedLayerChange}
                            />
                        </PanelSection>

                        <PanelSection title={translate('settings.appearance')}>
                            <AppearanceControls
                                locale={appearance.locale}
                                themeChoice={appearance.themeChoice}
                                resolvedTheme={appearance.resolvedTheme}
                                translate={translate}
                                onSelectLocale={(locale) => { kernel.appearance.selectLocale(locale); }}
                                onSelectTheme={(themeChoice) => { kernel.appearance.selectTheme(themeChoice); }}
                            />
                        </PanelSection>

                        <AboutPanel translate={translate} />
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

interface DrawerLayersProps {
    readonly controls: IndicatorControls;
    readonly expanded: string | null;
    readonly onExpandedChange: (instanceId: string | null) => void;
}

/**
 * The layer cards, reading the window themselves.
 *
 * A component of its own so the hook lives where the panel does: a drag rewrites
 * the viewport many times a second, and a closed drawer that followed it rebuilt
 * this whole dialog on every frame of one.
 */
function DrawerLayers({ controls, expanded, onExpandedChange }: DrawerLayersProps): ReactElement {
    return (
        <LayerAccordion
            controls={controls}
            state={useChartState()}
            expanded={expanded}
            onExpandedChange={onExpandedChange}
        />
    );
}

/**
 * Re-rendered only when what it shows changes.
 *
 * Closed, it is a button; the panel behind it does not exist. Following the
 * viewport from here rebuilt the dialog on every frame of a drag.
 */
export const SettingsDrawer = memo(SettingsDrawerShell);
