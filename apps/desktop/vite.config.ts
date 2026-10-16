/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: {
    // One copy of each, shared with @offerpath/ui and @offerpath/hunt: the
    // query cache and React contexts must be the same instances.
    dedupe: ['react', 'react-dom', '@tanstack/react-query', '@monaco-editor/react'],
  },
  server: {
    port: 1430,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1431 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    // One bundle read from local disk by the webview, not over a network;
    // Monaco (bundled, see src/monaco.ts) makes it about 4 MB.
    chunkSizeWarningLimit: 5000,
  },
  test: {
    environment: 'jsdom',
    // Shared CI runners are slow; a rendering test can take a few seconds there.
    testTimeout: 20_000,
    setupFiles: ['./src/test-setup.ts'],
  },
});
