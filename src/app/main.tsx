import { createServiceContainer } from './core/service-container.ts';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.tsx';
import './styles/theme.css';

const rootElement = document.getElementById('root');
if (rootElement === null) {
    throw new Error('The document is missing its #root element');
}

// The gateway serves this bundle, so its own origin is the API origin. Reading
// it here rather than inside the core is what keeps the core free of the DOM.
const container = createServiceContainer({
    baseUrl: window.location.origin,
    storage: window.localStorage,
    appearanceHost: {
        rootElement: document.documentElement,
        darkQuery: window.matchMedia('(prefers-color-scheme: dark)'),
        languages: navigator.languages,
    },
});

createRoot(rootElement).render(
    <StrictMode>
        <App container={container} />
    </StrictMode>,
);
