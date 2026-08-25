import type { ServiceContainer } from '../core/service-container.ts';
import type { ReactElement, ReactNode } from 'react';
import { KernelContext } from './kernel-context.ts';

interface KernelProviderProps {
    readonly container: ServiceContainer;
    readonly children: ReactNode;
}

/**
 * Injects the service container built by the entry point.
 *
 * Taking the container as a prop rather than building it here is what lets a
 * test render any screen against stubbed services without touching the network.
 */
export function KernelProvider({ container, children }: KernelProviderProps): ReactElement {
    return <KernelContext value={container}>{children}</KernelContext>;
}
