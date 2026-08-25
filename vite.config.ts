import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const GATEWAY_ORIGIN = process.env['GATEWAY_ORIGIN'] ?? 'http://127.0.0.1:8787';

export default defineConfig({
    plugins: [react(), tailwindcss()],
    server: {
        // Bound to every interface so the chart can be opened from a phone on the
        // same network, which is the layout this viewer is designed for first.
        host: true,
        proxy: {
            '/api': { target: GATEWAY_ORIGIN, ws: true, changeOrigin: true },
        },
    },
    build: {
        // Beside the compiled server rather than over it: `tsc` owns dist/server
        // and emptying a shared folder would delete whichever was built first.
        outDir: 'dist/app',
        emptyOutDir: true,
        target: 'es2022',
        sourcemap: true,
    },
});
