import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    // Shared CI runners are slow; a rendering test can take a few seconds there.
    testTimeout: 20_000,
    setupFiles: ['./src/__tests__/setup.ts'],
  },
});
