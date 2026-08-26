import { type ReactElement, useEffect } from 'react';
import { findIndicator } from '../../indicators/indicator-catalogue.ts';
import type { IndicatorControls } from '../../react/use-indicators.ts';
import { Undo2 } from 'lucide-react';
import { useTranslate } from '../../react/use-appearance.ts';
import { translateLabel } from '../../i18n/translator.ts';

/** Long enough to notice a mistake, short enough not to sit over the chart. */
const NOTICE_LIFETIME_MS = 7_000;

interface RemovalNoticeProps {
    readonly controls: IndicatorControls;
}

/**
 * Offers back the indicator that was just removed.
 *
 * Removal is one click and a tuned indicator is minutes of work, so the way
 * back has to be on screen rather than in a shortcut nobody is told about.
 */
export function RemovalNotice({ controls }: RemovalNoticeProps): ReactElement | null {
    const translate = useTranslate();
    const removed = controls.lastRemoved;
    const forget = controls.forgetRemoval;

    useEffect(() => {
        if (removed === null) {
            return;
        }
        const timer = setTimeout(forget, NOTICE_LIFETIME_MS);
        return () => { clearTimeout(timer); };
    }, [removed, forget]);

    const indicator = removed === null ? null : findIndicator(removed.indicatorId);
    if (removed === null || indicator === null) {
        return null;
    }

    return (
        <div className="pointer-events-auto flex items-center gap-3 rounded-md border border-hairline bg-abyss-800/95 px-3 py-2 shadow-lg shadow-black/50 backdrop-blur-sm">
            <span className="text-xs text-ink-300">
                {translate('indicators.removed', {
                    name: translateLabel(translate, indicator.labelKey),
                })}
            </span>
            <button
                type="button"
                onClick={controls.undoRemoval}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold text-phosphor hover:bg-phosphor/12"
            >
                <Undo2 className="size-3.5" />
                {translate('indicators.undo')}
            </button>
        </div>
    );
}
