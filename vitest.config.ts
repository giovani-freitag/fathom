import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        clearMocks: true,
        projects: [
            {
                test: {
                    // Everything that touches a DOM: the chart and its layers.
                    name: 'chart',
                    environment: 'jsdom',
                    setupFiles: ['./tests/setup.ts'],
                    include: ['tests/**/chart/**/*.test.ts'],
                },
            },
            {
                test: {
                    // The recording side, which never sees a browser.
                    name: 'server',
                    environment: 'node',
                    include: ['tests/**/*.test.ts'],
                    exclude: ['tests/**/chart/**'],
                },
            },
        ],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
            include: ['src/**'],
            exclude: ['src/main-*.ts', 'src/main-*.tsx', '**/*.d.ts'],
        },
    },
});
