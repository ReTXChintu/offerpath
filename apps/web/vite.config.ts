/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 50011,
    // In development the API runs separately; in production it serves this app
    // itself from the same origin, so the client always calls `/api/v1`.
    proxy: { '/api': 'http://localhost:50010' },
  },
  test: {
    environment: 'jsdom',
  },
});
