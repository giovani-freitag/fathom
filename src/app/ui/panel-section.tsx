import type { ReactElement, ReactNode } from 'react';

interface PanelSectionProps {
    readonly title: string;
    readonly children: ReactNode;
    /** A figure the whole section is about, set against its title. */
    readonly summary?: string;
    /** False for the first section in a panel, which has nothing to be ruled off from. */
    readonly isDivided?: boolean;
}

/**
 * One titled stretch of a settings panel.
 *
 * Written once because the same idea — a rule, a breath, a title, then the
 * controls — had been spelled out four times with three different amounts of
 * breath, and one of them had no title at all: a run of figures started
 * immediately under a pair of switches, with nothing saying they were a
 * different subject.
 */
export function PanelSection({
    title,
    children,
    summary,
    isDivided = true,
}: PanelSectionProps): ReactElement {
    return (
        <section className={`space-y-3 ${isDivided ? 'border-t border-hairline pt-4' : ''}`}>
            <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs text-ink-300">{title}</span>
                {summary !== undefined && (
                    <span className="numeric text-[11px] text-ink-500">{summary}</span>
                )}
            </div>
            {children}
        </section>
    );
}
