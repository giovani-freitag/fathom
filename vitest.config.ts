import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        clearMocks: true,
        projects: [
            {
                test: {
                    // The browser half, which needs a DOM to draw into.
                    name: 'app',
                    environment: 'jsdom',
                    setupFiles: ['./tests/setup.ts'],
                    include: ['tests/**/app/**/*.test.ts'],
                },
            },
            {
                test: {
                    // Everything that runs on Node, plus the shared contract.
                    name: 'node',
                    environment: 'node',
                    include: ['tests/**/*.test.ts'],
                    exclude: ['tests/**/app/**'],
                },
            },
        ],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'json-summary'],
            include: ['src/**/*.ts', 'src/**/*.tsx'],
            // Composition roots and request schemas: the first are the wiring a
            // test would have to duplicate to exercise, the second are literals
            // the type checker already reads.
            exclude: [
                'src/**/main.ts',
                'src/**/main.tsx',
                'src/workers/collector.ts',
                'src/workers/browser/collector-worker.ts',
                'src/server/http/schemas/**',
                '**/*.d.ts',
            ],
            // A floor the suite defends, not a snapshot of where it stands: a
            // number written into a badge by hand is stale by the next commit,
            // and the one that was there claimed five hundred tests out of five
            // hundred and fifty.
            thresholds: {
                statements: 60,
                branches: 55,
                functions: 50,
                lines: 60,
            },
        },
    },
});
