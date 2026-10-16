import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom lacks a few browser APIs Radix uses for positioning and pointer handling.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
const g = globalThis as unknown as Record<string, unknown>;
g.ResizeObserver ??= ResizeObserverStub;
const proto = Element.prototype as unknown as Record<string, unknown>;
proto.hasPointerCapture ??= () => false;
proto.releasePointerCapture ??= () => undefined;
proto.scrollIntoView ??= () => undefined;
// The router restores scroll on navigation; jsdom doesn't implement it.
window.scrollTo = () => undefined;

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

import { configure } from '@testing-library/react';

// Shared CI runners are slow: give findBy/waitFor more than the 1s default.
configure({ asyncUtilTimeout: 5000 });
