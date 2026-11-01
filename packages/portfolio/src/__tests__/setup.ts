import '@testing-library/jest-dom/vitest';
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jest-dom adds its matchers to whichever `vitest` it resolves from its own
// folder, and pnpm's hoisting can make that the workspace's vitest 2 while
// this package runs vitest 3. Adding them here types them for this package's.
declare module 'vitest' {
  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type */
  interface Assertion<T = any> extends TestingLibraryMatchers<any, T> {}
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<any, any> {}
  /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type */
}

// jsdom lacks a few browser APIs Radix uses for positioning and pointer handling.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
const g = globalThis as unknown as Record<string, unknown>;
g.ResizeObserver ??= ResizeObserverStub;
if (typeof Element !== 'undefined') {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.releasePointerCapture ??= () => undefined;
  proto.scrollIntoView ??= () => undefined;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

import { configure } from '@testing-library/react';

// Shared CI runners are slow: give findBy/waitFor more than the 1s default.
configure({ asyncUtilTimeout: 5000 });
