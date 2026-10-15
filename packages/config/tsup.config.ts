import { defineConfig } from 'tsup';

export default defineConfig((options) => ({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  // Never clean in watch mode: a watcher that deletes dist/ makes the API's
  // own watcher report missing declarations until the rebuild lands.
  clean: !options.watch,
  treeshake: true,
}));
