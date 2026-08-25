import { createDemoServiceContainer } from './core/demo-service-container.ts';
import { DemoShell } from './ui/demo-shell.tsx';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/theme.css';

const rootElement = document.getElementById('root');
if (rootElement === null) {
    throw new Error('The document is missing its #root element');
}

// Asks the browser not to evict what this page records. Chrome grants it on
// engagement and Safari mostly does not, so it is a request rather than a
// guarantee — which is why the chart only ever claims the coverage it has.
void navigator.storage.persist();

createRoot(rootElement).render(
    <StrictMode>
        <DemoShell
            factory={window.indexedDB}
            storage={window.localStorage}
            appearanceHost={{
                rootElement: document.documentElement,
                darkQuery: window.matchMedia('(prefers-color-scheme: dark)'),
                languages: navigator.languages,
            }}
            build={createDemoServiceContainer}
        />
    </StrictMode>,
);
