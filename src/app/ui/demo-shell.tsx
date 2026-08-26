import type { AppearanceHost } from '../core/appearance-controller.ts';
import type { CollectorEvent, CollectorState } from '../../shared/core/collector-worker-contract.ts';
import {
    type DemoServiceContainer,
    type DemoServiceContainerConfig,
} from '../core/demo-service-container.ts';
import { type ReactElement, useEffect, useState } from 'react';
import { App } from '../app.tsx';
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
 * The demo's own chrome: it starts the collector and says what it is doing.
 */
export function DemoShell({ factory, storage, appearanceHost, build }: DemoShellProps): ReactElement {
    const [state, setState] = useState<CollectorState>('starting');
    const [wasHidden, setWasHidden] = useState(false);
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

    if (state === 'refused') {
        return <RefusalNotice translate={translate} />;
    }
    if (!hasFirstFrame) {
        return <PreRollNotice translate={translate} />;
    }

    return (
        <div className="relative size-full">
            <App container={container} />
            <DemoBanner state={state} wasHidden={wasHidden} translate={translate} />
        </div>
    );
}

function PreRollNotice({ translate }: { readonly translate: Translate }): ReactElement {
    return (
        <div className="flex size-full items-center justify-center bg-abyss-950 p-8">
            <div className="max-w-sm space-y-3 text-center">
                <h1 className="text-sm font-semibold tracking-wide text-ink-100">
                    {translate('demo.preRollTitle')}
                </h1>
                <p className="text-xs leading-relaxed text-ink-400">
                    {translate('demo.preRollBody')}
                </p>
            </div>
        </div>
    );
}

function DemoBanner({ state, wasHidden, translate }: {
    readonly state: CollectorState;
    readonly wasHidden: boolean;
    readonly translate: Translate;
}): ReactElement | null {
    const message = resolveBannerMessage(state, wasHidden, translate);
    if (message === null) {
        return null;
    }

    return (
        <div className="pointer-events-none absolute inset-x-0 bottom-20 flex justify-center px-4">
            <p className="rounded-md border border-hairline bg-abyss-900/90 px-3 py-2 text-center text-[11px] leading-snug text-ink-300 backdrop-blur-sm">
                {message}
            </p>
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
        <div className="flex size-full items-center justify-center bg-abyss-950 p-8">
            <div className="max-w-md space-y-3 text-center">
                <h1 className="text-sm font-semibold tracking-wide text-ink-100">
                    {translate('demo.refusedTitle')}
                </h1>
                <p className="text-xs leading-relaxed text-ink-400">
                    {translate('demo.refusedBody')}
                </p>
            </div>
        </div>
    );
}
