import { useCallback, useEffect, useRef, useState } from 'react';
import { type AddonBuild, buildAddon } from '../addons/addon-runtime.ts';
import { AddonEditorService, type SourceFault } from '../services/addon-editor/addon-editor-service.ts';
import { forgetAddon, registerAddon } from '../addons/addon-registry.ts';
import { readLayerDefaults } from '../indicators/indicator-catalogue.ts';
import { useKernel } from './kernel-context.ts';
import { withIndicatorAdded } from '../../shared/core/indicator-selection.ts';

/** The one reading the editor holds, which replacing does not multiply. */
const DRAFT_NAME = 'draft';

/** Where the reader's script survives a reload. */
const STORED_SOURCE = 'fathom.addon.draft';

/** What the panel shows about the script as it stands. */
export type EditorStatus =
    | { readonly kind: 'ready'; readonly label: string }
    | { readonly kind: 'faulted'; readonly faults: readonly SourceFault[] }
    | { readonly kind: 'broken'; readonly message: string };

export interface AddonEditorControls {
    /** Where to mount the editor. */
    readonly hostRef: (node: HTMLDivElement | null) => void;
    readonly status: EditorStatus | null;
    readonly isRunning: boolean;
}

function readStoredSource(fallback: string): string {
    try {
        return globalThis.localStorage.getItem(STORED_SOURCE) ?? fallback;
    } catch {
        return fallback;
    }
}

function storeSource(source: string): void {
    try {
        globalThis.localStorage.setItem(STORED_SOURCE, source);
    } catch {
        // A reader with storage turned off still gets the editor; they only
        // lose the script when the page closes.
    }
}

/**
 * Drives the in-page editor and puts what it produces on the chart.
 *
 * @param starter - What a reader with nothing stored opens on.
 * @returns Where to mount, and what to say about what is there.
 */
export function useAddonEditor(starter: string): AddonEditorControls {
    const kernel = useKernel();
    const [status, setStatus] = useState<EditorStatus | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    const serviceRef = useRef<AddonEditorService | null>(null);

    const publish = useCallback((build: AddonBuild): void => {
        const service = serviceRef.current;
        if (build.kind === 'failed') {
            setStatus({ kind: 'broken', message: build.message });
            service?.showRuntimeFault(build);
            return;
        }

        service?.showRuntimeFault(null);
        const id = registerAddon(DRAFT_NAME, build.indicator);
        setStatus({ kind: 'ready', label: build.indicator.label });
        kernel.chart.updateIndicators((current) => (
            current.some((entry) => entry.indicatorId === id)
                // Rebuilt in place: a new array is what makes the chart run the
                // reading again, and the reader keeps the copy they tuned.
                ? [...current]
                : withIndicatorAdded({
                    added: current,
                    indicatorId: id,
                    settings: readLayerDefaults(build.indicator),
                    tone: 'phosphor',
                    isRepeatable: false,
                })
        ));
    }, [kernel]);

    const rebuild = useCallback(async (source: string): Promise<void> => {
        const service = serviceRef.current;
        if (service === null) {
            return;
        }
        storeSource(source);
        setIsRunning(true);
        try {
            const { compiled, faults } = await service.compile();
            if (faults.length > 0) {
                setStatus({ kind: 'faulted', faults });
                return;
            }
            publish(buildAddon(compiled));
        } finally {
            setIsRunning(false);
        }
    }, [publish]);

    const hostRef = useCallback((node: HTMLDivElement | null): void => {
        if (node === null) {
            return;
        }
        const service = new AddonEditorService({ onChange: (source) => { void rebuild(source); } });
        serviceRef.current = service;
        service.mount(node, readStoredSource(starter));
        void rebuild(service.readSource());
    }, [rebuild, starter]);

    useEffect(() => () => {
        serviceRef.current?.unmount();
        serviceRef.current = null;
        forgetAddon(`addon:${DRAFT_NAME}`);
    }, []);

    return { hostRef, status, isRunning };
}
