import { defineConfig } from 'tsup';

export default defineConfig((options) => ({
  // The stylesheet is its own entry: apps import `@offerpath/portfolio/styles.css`
  // once, after `@offerpath/ui/styles.css`.
  entry: ['src/index.ts', 'src/styles.css'],
  format: ['esm'],
  dts: { entry: 'src/index.ts' },
  sourcemap: true,
  // Never clean in watch mode (see packages/shared/tsup.config.ts).
  clean: !options.watch,
  treeshake: true,
}));
