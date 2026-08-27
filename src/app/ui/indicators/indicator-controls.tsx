import { Popover } from 'radix-ui';
import { ChartSpline } from 'lucide-react';
import { type ReactElement, useCallback, useEffect, useState } from 'react';
import type { ChartLayout } from '../../painting/render-types.ts';
import { ControlButton } from '../control-button.tsx';
import { IndicatorLegend } from './indicator-legend.tsx';
import { IndicatorPalette } from './indicator-palette.tsx';
import type { IndicatorControls } from '../../react/use-indicators.ts';
import { RemovalNotice } from './removal-notice.tsx';
import { useTranslate } from '../../react/use-appearance.ts';

interface IndicatorTriggerProps {
    readonly controls: IndicatorControls;
}

/**
 * Opens the catalogue, from the header or from the keyboard.
 */
export function IndicatorTrigger({ controls }: IndicatorTriggerProps): ReactElement {
    const translate = useTranslate();
    const [isOpen, setIsOpen] = useState(false);
    const open = useCallback(() => { setIsOpen(true); }, []);

    useOpenShortcut(open);

    return (
        <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
            <Popover.Trigger asChild>
                <ControlButton
                    aria-label={translate('indicators.open')}
                    title={translate('indicators.openWith', { shortcut: readShortcutLabel() })}
                >
                    <ChartSpline className="size-4" />
                </ControlButton>
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Content
                    sideOffset={6}
                    align="end"
                    className="z-50 rounded-lg border border-hairline bg-abyss-800 p-2 shadow-2xl shadow-black/60"
                >
                    <IndicatorPalette
                        onAdd={controls.add}
                        isFull={controls.isFull}
                        addedCounts={controls.addedCounts}
                        hasAutoFocus
                    />
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}

interface IndicatorOverlayProps {
    readonly controls: IndicatorControls;
    readonly layout: ChartLayout;
    readonly onOpenSettings: (instanceId: string) => void;
}

/**
 * Everything the chart itself says about the indicators on it.
 */
export function IndicatorOverlay({ controls, layout, onOpenSettings }: IndicatorOverlayProps): ReactElement {
    return (
        <>
            <IndicatorLegend controls={controls} layout={layout} onOpenSettings={onOpenSettings} />
            <div className="pointer-events-none absolute bottom-3 left-3">
                <RemovalNotice controls={controls} />
            </div>
        </>
    );
}

/**
 * The chord this platform's readers reach for to open a palette.
 */
function readShortcutLabel(): string {
    const isApple = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
    return isApple ? '⌘K' : 'Ctrl K';
}

/**
 * Opens the catalogue on the chord a reader expects a palette to answer.
 */
function useOpenShortcut(onOpen: () => void): void {
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent): void => {
            if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                onOpen();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => { window.removeEventListener('keydown', handleKeyDown); };
    }, [onOpen]);
}
