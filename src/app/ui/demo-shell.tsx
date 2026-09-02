import type { AppearanceHost } from '../core/appearance-controller.ts';
import type { CollectorEvent, CollectorState } from '../../shared/core/collector-worker-contract.ts';
import {
    type DemoServiceContainer,
    type DemoServiceContainerConfig,
} from '../core/demo-service-container.ts';
import { type ReactElement, useEffect, useState } from 'react';
import { App } from '../app.tsx';
import { X } from 'lucide-react';
import { buildTranslate, type Translate } from '../i18n/translator.ts';
import { useStore } from '../react/use-store.ts';
import { useMemo } from 'react';

export interface DemoShellProps {
    readonly factory: IDBFactory | null;
    readonly storage: Storage | null;
    readonly appearanceHost: AppearanceHost | null;
    readonly build: (config: DemoServiceContainerConfig) => DemoServiceContainer;
}

/**
 * How long the notice about a backgrounded tab stays up.
 *
 * Long enough to read twice and no longer. It explains the gaps the reader has
 * just come back to, and a minute later they are looking at something else.
 */
const GAP_NOTICE_MS = 12_000;

/**
 * The demo's own chrome: it starts the collector and says what it is doing.
 */
export function DemoShell({ factory, storage, appearanceHost, build }: DemoShellProps): ReactElement {
    const [state, setState] = useState<CollectorState>('starting');
    const [wasHidden, setWasHidden] = useState(false);
    // Said once and then let go of. A reader who has moved between tabs a few
    // times knows why the gaps are there, and a page that keeps saying so is a
    // page with a strip across it for the rest of the session.
    const [hasHeardAboutGaps, setHasHeardAboutGaps] = useState(false);
    const [hasFirstFrame, setHasFirstFrame] = useState(false);
    // Built once, lazily, so the collector's handle survives a re-render and
    // React never sees construction happen during one.
    const [container] = useState<DemoServiceContainer>(() => build({
        factory,
        storage,
        appearanceHost,
        onCollectorEvent: (event: CollectorEvent) => {
            if (event.kind !== 'state') {
                return;
            }
            setState(event.state);
        },
    }));

    // The notices below are drawn before the chart exists, so they cannot reach
    // the language through the kernel the way the rest of the tree does.
    const { locale } = useStore(container.appearance.store);
    const translate = useMemo(() => buildTranslate(locale), [locale]);

    // The page reads through its own connection, so it has to open one before
    // the chart asks for a window. The collector is started only once that
    // succeeded: a page that cannot read has nothing to show it either.
    useEffect(() => {
        let wasCancelled = false;
        container.appearance.start();
        container.database.open().then(
            () => {
                if (wasCancelled) {
                    return;
                }
                container.collector.start();
            },
            (error: unknown) => {
                if (wasCancelled) {
                    return;
                }
                setState('refused');
                // Kept off the screen: whoever can act on the wording of a
                // storage fault is reading a console, not a chart.
                console.error(error);
            },
        );

        return () => {
            wasCancelled = true;
            container.collector.stop();
            container.database.close();
            container.chart.dispose();
            container.appearance.dispose();
        };
    }, [container]);

    // The chart decides there is nothing to show the first time it looks, and a
    // page that starts its own recording is always empty at that moment. It is
    // only mounted once a second exists for it to draw.
    useEffect(() => {
        if (hasFirstFrame) {
            return;
        }
        const timer = setInterval(() => {
            void container.api.fetchInstruments().then((instruments) => {
                if (instruments.some((instrument) => instrument.lastFrameAtMs !== null)) {
                    setHasFirstFrame(true);
                }
            }, () => undefined);
        }, 1_000);

        return () => { clearInterval(timer); };
    }, [container, hasFirstFrame]);

    // Browsers slow a hidden page's timers to about one wake a minute, so the
    // seconds it misses are recorded as gaps. That is correct, and it looks
    // like a fault unless the page says why.
    useEffect(() => {
        const handleVisibilityChange = (): void => {
            if (document.visibilityState === 'hidden') {
                setWasHidden(true);
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => { document.removeEventListener('visibilitychange', handleVisibilityChange); };
    }, []);

    // Cleared on its own as well as by hand: the gaps it explains are the ones
    // just left behind, and nobody reads a notice about them a minute later.
    useEffect(() => {
        if (!wasHidden || hasHeardAboutGaps) {
            return undefined;
        }
        const timer = setTimeout(() => { setWasHidden(false); }, GAP_NOTICE_MS);
        return () => { clearTimeout(timer); };
    }, [wasHidden, hasHeardAboutGaps]);

    if (state === 'refused') {
        return <RefusalNotice translate={translate} />;
    }
    if (!hasFirstFrame) {
        return <PreRollNotice translate={translate} />;
    }

    return (
        <div className="relative size-full">
            <App container={container} />
            <DemoBanner
                state={state}
                wasHidden={wasHidden && !hasHeardAboutGaps}
                onDismissGaps={() => {
                    setWasHidden(false);
                    setHasHeardAboutGaps(true);
                }}
                translate={translate}
            />
        </div>
    );
}

function PreRollNotice({ translate }: { readonly translate: Translate }): ReactElement {
    return (
        <PageNotice
            title={translate('demo.preRollTitle')}
            body={translate('demo.preRollBody')}
        />
    );
}

function DemoBanner({ state, wasHidden, onDismissGaps, translate }: {
    readonly state: CollectorState;
    readonly wasHidden: boolean;
    readonly onDismissGaps: () => void;
    readonly translate: Translate;
}): ReactElement | null {
    const message = resolveBannerMessage(state, wasHidden, translate);
    if (message === null) {
        return null;
    }

    // What the collector is doing is the page's own state and stays until it
    // changes. What a backgrounded tab did is a thing that happened, and the
    // reader is the one who decides they have finished with it.
    const isDismissible = state !== 'starting' && state !== 'stopped';

    return (
        <div
            className={`pointer-events-none absolute bottom-20 px-4 ${
                isDismissible ? 'left-0 max-w-sm' : 'inset-x-0 flex justify-center'
            }`}
        >
            <div className="pointer-events-auto flex items-start gap-2 rounded-md border border-hairline bg-abyss-900/90 px-3 py-2 backdrop-blur-sm">
                <p className={`text-[11px] leading-snug text-ink-300 ${isDismissible ? '' : 'text-center'}`}>
                    {message}
                </p>
                {isDismissible && (
                    <button
                        type="button"
                        onClick={onDismissGaps}
                        title={translate('demo.dismiss')}
                        aria-label={translate('demo.dismiss')}
                        className="-mr-1 -mt-0.5 grid size-5 shrink-0 place-items-center rounded text-ink-500 transition-colors hover:text-ink-200"
                    >
                        <X className="size-3.5" />
                    </button>
                )}
            </div>
        </div>
    );
}

function resolveBannerMessage(
    state: CollectorState,
    wasHidden: boolean,
    translate: Translate,
): string | null {
    if (state === 'starting') {
        return translate('demo.connecting');
    }
    if (state === 'stopped') {
        return translate('demo.stopped');
    }
    if (wasHidden) {
        return translate('demo.wasHidden');
    }
    return null;
}

function RefusalNotice({ translate }: { readonly translate: Translate }): ReactElement {
    return (
        <PageNotice
            title={translate('demo.refusedTitle')}
            body={translate('demo.refusedBody')}
        />
    );
}

/**
 * A page that is only a message, for the moments before there is a chart.
 *
 * Written once because it was written twice, in widths that had drifted apart
 * for no reason either of them could give.
 */
function PageNotice({ title, body }: { readonly title: string; readonly body: string }): ReactElement {
    return (
        <div className="flex size-full items-center justify-center bg-abyss-950 p-8">
            <div className="max-w-md space-y-3 text-center">
                <h1 className="text-sm font-semibold tracking-wide text-ink-100">{title}</h1>
                <p className="text-xs leading-relaxed text-ink-400">{body}</p>
            </div>
        </div>
    );
}
