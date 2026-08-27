import { CONTROL_BUTTON_CLASSES, CONTROL_RESTING_CLASSES } from './control-shell.ts';
import { PanelSection } from './panel-section.tsx';
import { Menu, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { memo, type ReactElement } from 'react';
import { AboutPanel } from './about-panel.tsx';
import { AppearanceControls } from './appearance-controls.tsx';
import { useAppearance, useTranslate } from '../react/use-appearance.ts';
import { useKernel } from '../react/kernel-context.ts';

interface SettingsDrawerProps {
    readonly isOpen: boolean;
    readonly onOpenChange: (isOpen: boolean) => void;
    /** True where it sits over the chart rather than in a bar of controls. */
    readonly isFloating?: boolean;
}

/** Over the chart it needs a shell of its own; in a bar it takes the bar's. */
const FLOATING_TRIGGER_CLASSES =
    'pointer-events-auto grid size-9 shrink-0 place-items-center rounded-lg border border-hairline'
    + ' bg-abyss-800/95 text-ink-400 shadow-lg backdrop-blur transition-colors'
    + ' hover:border-hairline-bright hover:text-ink-100';

/**
 * What the chart looks like and what it is, in one drawer.
 *
 * The layers used to be listed in here as well as in their own panel, which
 * meant a reader could be looking at two lists of the same thing that answered
 * to different controls. They live in one place now, and this is what is left:
 * the appearance, and what this build is.
 */
function SettingsDrawerShell({
    isOpen,
    onOpenChange,
    isFloating = false,
}: SettingsDrawerProps): ReactElement {
    const kernel = useKernel();
    const translate = useTranslate();
    const appearance = useAppearance();

    return (
        <Dialog.Root open={isOpen} onOpenChange={onOpenChange}>
            <Dialog.Trigger asChild>
                <button
                    type="button"
                    aria-label={translate('settings.open')}
                    title={translate('settings.open')}
                    className={isFloating ? FLOATING_TRIGGER_CLASSES : `${CONTROL_BUTTON_CLASSES} ${CONTROL_RESTING_CLASSES}`}
                >
                    <Menu className="size-[18px]" />
                </button>
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

                        <PanelSection isDivided={false} title={translate('settings.appearance')}>
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

/**
 * Re-rendered only when it is opened or closed.
 *
 * It reads the appearance, which nothing on the chart touches while a reader is
 * dragging it about.
 */
export const SettingsDrawer = memo(SettingsDrawerShell);
