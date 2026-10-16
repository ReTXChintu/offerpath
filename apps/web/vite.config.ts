/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // The repo keeps one .env at the root (VITE_OFFERPATH_API_URL, if set).
  envDir: '../..',
  resolve: {
    // One copy of each, shared with @offerpath/ui, hunt and learn: the query
    // cache, React contexts and Monaco's loader must be the same instances.
    dedupe: ['react', 'react-dom', '@tanstack/react-query', '@monaco-editor/react'],
  },
  server: {
    port: 50004,
    strictPort: true,
    // In development the API runs separately on 50005; the client calls /api/v1.
    proxy: { '/api': 'http://localhost:50005' },
  },
  preview: { port: 50004 },
  build: {
    // Monaco (bundled, see src/monaco.ts) is most of the size.
    chunkSizeWarningLimit: 5000,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
