import type { ServiceContainer } from './core/service-container.ts';
import { HeatmapPage } from './ui/heatmap-page.tsx';
import { KernelProvider } from './react/kernel-provider.tsx';
import { type ReactElement, useEffect } from 'react';

interface AppProps {
    readonly container: ServiceContainer;
}

/**
 * The application root, taking its services from the entry point.
 */
export function App({ container }: AppProps): ReactElement {
    // Started rather than torn down: the theme and the language live as long as
    // the document does, and the listener goes with it.
    useEffect(() => { container.appearance.start(); }, [container]);

    return (
        <KernelProvider container={container}>
            <HeatmapPage />
        </KernelProvider>
    );
}
