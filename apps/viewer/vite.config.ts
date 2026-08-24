import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const GATEWAY_ORIGIN = process.env['GATEWAY_ORIGIN'] ?? 'http://127.0.0.1:8787';

export default defineConfig({
    plugins: [react(), tailwindcss()],
    resolve: {
        alias: {
            '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
            '@react': fileURLToPath(new URL('./src/react', import.meta.url)),
            '@ui': fileURLToPath(new URL('./src/ui', import.meta.url)),
            '@features': fileURLToPath(new URL('./src/features', import.meta.url)),
        },
    },
    server: {
        // Bound to every interface so the chart can be opened from a phone on the
        // same network, which is the layout this viewer is designed for first.
        host: true,
        proxy: {
            '/api': { target: GATEWAY_ORIGIN, ws: true, changeOrigin: true },
        },
    },
    build: {
        target: 'es2022',
        sourcemap: true,
    },
});
