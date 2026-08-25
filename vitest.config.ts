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
            reporter: ['text', 'html'],
            include: ['src/**'],
            exclude: ['src/**/main.ts', 'src/**/main.tsx', 'src/workers/collector.ts', '**/*.d.ts'],
        },
    },
});
