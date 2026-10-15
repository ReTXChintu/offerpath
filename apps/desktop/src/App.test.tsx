import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { App } from './App';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.resolve('0.0.0')) }));

it('renders the product name', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: 'Offerpath' })).toBeTruthy();
});
