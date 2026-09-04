import type { ReactElement } from 'react';
import type { Translate } from '../i18n/translator.ts';
import { GUIDE_HOME_URLS } from '../i18n/guide-urls.ts';
import { useAppearance } from '../react/use-appearance.ts';

export interface AboutPanelProps {
    readonly translate: Translate;
}

/**
 * Which build is on screen, and what changed in it.
 */
export function AboutPanel({ translate }: AboutPanelProps): ReactElement {
    const { locale } = useAppearance();
    const notes = __RELEASE_NOTES__;

    return (
        <div className="space-y-2 border-t border-hairline pt-4 text-[11px] text-ink-500">
            <div className="flex items-baseline justify-between gap-3">
                <span className="numeric">Fathom {__APP_VERSION__}</span>
                <span>
                    {notes === null
                        ? translate('about.unreleased')
                        : translate('about.releasedOn', { date: notes.releasedOn })}
                </span>
            </div>

            {/*
                Here rather than in the editor's own bar, which is the only
                other way to the guide: a reader who has never written a
                reading has no cause to open that panel, and they are the one
                the guide was written for.
            */}
            <a
                href={GUIDE_HOME_URLS[locale]}
                target="_blank"
                rel="noreferrer"
                className="flex h-10 items-center text-ink-300 underline-offset-2 transition-colors hover:text-phosphor hover:underline"
            >
                {translate('about.guide')}
            </a>

            {notes !== null && notes.changes.length > 0 && (
                <details className="group">
                    <summary className="cursor-pointer list-none text-ink-300 marker:content-none hover:text-ink-100">
                        <span className="inline-block transition-transform group-open:rotate-90">›</span>
                        {' '}
                        {translate('about.whatsNew')}
                    </summary>
                    {/*
                        The entries are the commit subjects the changelog was
                        generated from, so they stay in the language they were
                        written in rather than being half-translated here.
                    */}
                    <div className="mt-2 space-y-2 pl-3">
                        {notes.changes.map((change) => (
                            <div key={change.heading}>
                                <span className="block text-ink-400">{change.heading}</span>
                                <ul className="mt-0.5 space-y-0.5">
                                    {change.entries.map((entry) => (
                                        <li key={entry} className="leading-snug text-ink-500">
                                            · {entry}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                </details>
            )}
        </div>
    );
}
