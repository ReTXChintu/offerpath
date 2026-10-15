import { defineConfig } from 'tsup';

export default defineConfig((options) => ({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: !options.watch,
  // The generated client and its engines stay a plain dependency.
  external: ['@prisma/client'],
}));
