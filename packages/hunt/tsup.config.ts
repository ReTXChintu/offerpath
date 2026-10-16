import { defineConfig } from 'tsup';

export default defineConfig((options) => ({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  // Never clean in watch mode (see packages/shared/tsup.config.ts).
  clean: !options.watch,
  treeshake: true,
}));
