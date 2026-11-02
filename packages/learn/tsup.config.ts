import { defineConfig } from 'tsup';

export default defineConfig((options) => ({
  // The stylesheet is its own entry: apps import `@offerpath/learn/styles.css`
  // once, after `@offerpath/ui/styles.css`.
  // The microphone's AudioWorklet is its own file, loaded by URL from the
  // app's origin (`src/lib/live/mic.ts`): `dist/pcm-capture.worklet.js`.
  entry: {
    index: 'src/index.ts',
    styles: 'src/styles.css',
    'pcm-capture.worklet': 'src/lib/live/pcm-capture.worklet.ts',
  },
  format: ['esm'],
  dts: { entry: 'src/index.ts' },
  sourcemap: true,
  // Never clean in watch mode (see packages/shared/tsup.config.ts).
  clean: !options.watch,
  treeshake: true,
  // Monaco is loaded by the host (bundled on the desktop, whose CSP allows no CDN).
  external: ['@monaco-editor/react'],
}));
