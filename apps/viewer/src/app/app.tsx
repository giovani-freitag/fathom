import type { ServiceContainer } from '@core/kernel/service-container';
import { HeatmapPage } from '@features/heatmap/heatmap-page';
import { KernelProvider } from '@react/kernel-provider';
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
