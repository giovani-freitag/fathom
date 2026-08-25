import type { ServiceContainer } from './chart/service-container.ts';
import { HeatmapPage } from './chart/ui/heatmap-page.tsx';
import { KernelProvider } from './chart/react/kernel-provider.tsx';
import type { ReactElement } from 'react';

interface AppProps {
    readonly container: ServiceContainer;
}

/**
 * The application root, taking its services from the entry point.
 */
export function App({ container }: AppProps): ReactElement {
    return (
        <KernelProvider container={container}>
            <HeatmapPage />
        </KernelProvider>
    );
}
