import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The viewer's own aliases, repeated here because a project declared inline does
// not inherit the app's vite config.
const viewerAliases = {
    '@core': fileURLToPath(new URL('./apps/viewer/src/core', import.meta.url)),
    '@react': fileURLToPath(new URL('./apps/viewer/src/react', import.meta.url)),
    '@ui': fileURLToPath(new URL('./apps/viewer/src/ui', import.meta.url)),
    '@features': fileURLToPath(new URL('./apps/viewer/src/features', import.meta.url)),
};

export default defineConfig({
    test: {
        clearMocks: true,
        projects: [
            {
                test: {
                    name: 'contracts',
                    environment: 'node',
                    root: './packages/contracts',
                    include: ['tests/**/*.test.ts'],
                },
            },
            {
                test: {
                    name: 'persistence',
                    environment: 'node',
                    root: './packages/persistence',
                    include: ['tests/**/*.test.ts'],
                },
            },
            {
                test: {
                    name: 'collector',
                    environment: 'node',
                    root: './apps/collector',
                    include: ['tests/**/*.test.ts'],
                },
            },
            {
                test: {
                    name: 'gateway',
                    environment: 'node',
                    root: './apps/gateway',
                    include: ['tests/**/*.test.ts'],
                },
            },
            {
                resolve: { alias: viewerAliases },
                test: {
                    name: 'viewer',
                    environment: 'jsdom',
                    root: './apps/viewer',
                    include: ['tests/**/*.test.ts'],
                    setupFiles: ['./tests/setup.ts'],
                },
            },
            {
                test: {
                    name: 'arch',
                    environment: 'node',
                    include: ['tests/arch/**/*.test.ts'],
                },
            },
        ],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
            include: ['packages/*/src/**', 'apps/*/src/**'],
            exclude: ['**/main.ts', '**/index.ts', '**/*.d.ts'],
        },
    },
});
