import type { CollectorEvent, CollectorState } from '../../shared/core/collector-worker-contract.ts';
import {
    type DemoServiceContainer,
    type DemoServiceContainerConfig,
} from '../core/demo-service-container.ts';
import { type ReactElement, useEffect, useState } from 'react';
import { App } from '../app.tsx';

export interface DemoShellProps {
    readonly factory: IDBFactory | null;
    readonly storage: Storage | null;
    readonly build: (config: DemoServiceContainerConfig) => DemoServiceContainer;
}

/**
 * The demo's own chrome: it starts the collector and says what it is doing.
 *
 * The served chart can assume a recording already exists. This one cannot — a
 * visitor arrives at an empty archive and has to be told that the seconds are
 * being captured now, or an empty canvas reads as a broken page.
 */
export function DemoShell({ factory, storage, build }: DemoShellProps): ReactElement {
    const [state, setState] = useState<CollectorState>('starting');
    const [detail, setDetail] = useState<string | null>(null);
    const [wasHidden, setWasHidden] = useState(false);
    const [isArchiveOpen, setIsArchiveOpen] = useState(false);
    // Built once, lazily, so the collector's handle survives a re-render and
    // React never sees construction happen during one.
    const [container] = useState<DemoServiceContainer>(() => build({
        factory,
        storage,
        onCollectorEvent: (event: CollectorEvent) => {
            if (event.kind !== 'state') {
                return;
            }
            setState(event.state);
            setDetail(event.detail ?? null);
        },
    }));

    // The page reads through its own connection, so it has to open one before
    // the chart asks for a window. The collector is started only once that
    // succeeded: a page that cannot read has nothing to show it either.
    useEffect(() => {
        let wasCancelled = false;
        container.database.open().then(
            () => {
                if (wasCancelled) {
                    return;
                }
                setIsArchiveOpen(true);
                container.collector.start();
            },
            (error: unknown) => {
                if (wasCancelled) {
                    return;
                }
                setState('refused');
                setDetail(error instanceof Error ? error.message : String(error));
            },
        );

        return () => {
            wasCancelled = true;
            container.collector.stop();
            container.database.close();
        };
    }, [container]);

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
        return <RefusalNotice detail={detail} />;
    }
    if (!isArchiveOpen) {
        return <OpeningNotice />;
    }

    return (
        <div className="relative size-full">
            <App container={container} />
            <DemoBanner state={state} wasHidden={wasHidden} />
        </div>
    );
}

function OpeningNotice(): ReactElement {
    return (
        <div className="flex size-full items-center justify-center bg-abyss-950">
            <p className="text-xs text-ink-500">Opening the local archive…</p>
        </div>
    );
}

function DemoBanner({ state, wasHidden }: {
    readonly state: CollectorState;
    readonly wasHidden: boolean;
}): ReactElement | null {
    const message = resolveBannerMessage(state, wasHidden);
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

function resolveBannerMessage(state: CollectorState, wasHidden: boolean): string | null {
    if (state === 'starting') {
        return 'Connecting to the venue and mirroring the book. The first columns appear within seconds.';
    }
    if (state === 'stopped') {
        return 'Recording stopped. Reload to start again.';
    }
    if (wasHidden) {
        return 'This tab was in the background. Browsers slow timers there, so those seconds are recorded as gaps rather than invented.';
    }
    return null;
}

function RefusalNotice({ detail }: { readonly detail: string | null }): ReactElement {
    return (
        <div className="flex size-full items-center justify-center bg-abyss-950 p-8">
            <div className="max-w-md space-y-3 text-center">
                <h1 className="text-sm font-semibold tracking-wide text-ink-100">
                    This browser will not let the demo record
                </h1>
                <p className="text-xs leading-relaxed text-ink-400">
                    The page stores what it captures in the browser&rsquo;s own database. Private
                    windows and some privacy settings block it, and there is nowhere else to put a
                    recording that only exists while you watch.
                </p>
                {detail === null ? null : (
                    <p className="numeric text-[11px] text-ink-600">{detail}</p>
                )}
            </div>
        </div>
    );
}
