import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { readReleaseDefines } from './scripts/release-notes.ts';

/**
 * Where the demo will be served from.
 *
 * A GitHub project site lives under `/<repo>/`, not at the root, and every
 * asset path in the built page is resolved against this. Left at the default
 * the page loads and every script 404s, which looks like a broken build rather
 * than a misconfigured one.
 */
const BASE_PATH = process.env['DEMO_BASE_PATH'] ?? '/fathom/';

export default defineConfig({
    // The page is its own root so the built entry is `index.html`, which is what
    // a static host serves at a directory URL. Naming it anything else means a
    // visitor to the bare address gets a 404 instead of the chart.
    root: 'demo',
    // Brand asset lives with the app, not with the demo's own root.
    publicDir: '../public',
    base: BASE_PATH,
    plugins: [react(), tailwindcss()],
    // Read at build time: the page is static, so there is nothing to ask later.
    define: readReleaseDefines(),
    build: {
        outDir: '../dist/demo',
        emptyOutDir: true,
        target: 'es2022',
        sourcemap: true,
    },
    worker: {
        // The collector is registered as a module worker, so its own imports
        // have to survive bundling rather than being inlined into one script.
        format: 'es',
    },
});
