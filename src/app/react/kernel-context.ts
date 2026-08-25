import type { ServiceContainer } from '../core/service-container.ts';
import { createContext, useContext } from 'react';

/**
 * Carries the service container down the tree.
 */
export const KernelContext = createContext<ServiceContainer | null>(null);

/**
 * The service container for the current tree.
 *
 * @returns The container provided above this component.
 * @throws Error when called outside `KernelProvider`, which is a wiring mistake
 *         rather than a state the interface should try to render around.
 */
export function useKernel(): ServiceContainer {
    const container = useContext(KernelContext);
    if (container === null) {
        throw new Error('useKernel was called outside KernelProvider');
    }
    return container;
}
