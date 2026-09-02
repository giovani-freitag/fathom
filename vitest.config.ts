import { defineConfig } from 'vitest/config';
import { readReleaseDefines } from './scripts/release-notes.ts';

/** How long one test may take before it is called stuck. */
const TEST_TIMEOUT_MS = 20_000;

export default defineConfig({
    test: {
        clearMocks: true,
        // A timeout is here to catch a test that has hung, not to police how
        // long one takes. The default of five seconds is meant for tests that
        // mock their world; the ones here record hundreds of instants and
        // squeeze the squares they fall into, which is half a second on the
        // machine they were written on and several times that on a shared
        // runner — measured, three of them timed out on one CI run and three
        // different ones on the next, with nothing changed between them.
        // Declared per project below as well as here: a project inherits none
        // of this, which is the same lesson the injection above records — and
        // set only here it was never in force at all, so the runs it was meant
        // to steady went on timing out at the default five seconds.
        testTimeout: TEST_TIMEOUT_MS,
        projects: [
            {
                // The same build-time injection the app gets, so a test may
                // render the panel that reads it rather than mock around it.
                // Declared per project: the projects do not inherit it.
                define: readReleaseDefines(),
                test: {
                    testTimeout: TEST_TIMEOUT_MS,
                    // The browser half, which needs a DOM to draw into.
                    name: 'app',
                    environment: 'jsdom',
                    setupFiles: ['./tests/setup.ts'],
                    include: ['tests/**/app/**/*.test.{ts,tsx}'],
                },
            },
            {
                test: {
                    testTimeout: TEST_TIMEOUT_MS,
                    // Everything that runs on Node, plus the shared contract.
                    name: 'node',
                    environment: 'node',
                    include: ['tests/**/*.test.{ts,tsx}'],
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
                'src/server/http/server.ts',
                'src/server/http/schemas/**',
                '**/*.d.ts',
            ],
            // A floor the suite defends, not a snapshot of where it stands: a
            // number written into a badge by hand is stale by the next commit,
            // and the one that was there claimed five hundred tests out of five
            // hundred and fifty.
            thresholds: {
                statements: 78,
                branches: 66,
                functions: 71,
                lines: 78,
            },
        },
    },
});
