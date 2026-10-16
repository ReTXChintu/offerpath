import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { THEME_STORAGE_KEY, ThemeProvider, ThemeSelect, useTheme } from '../index';

function Resolved() {
  const { resolved, preference } = useTheme();
  return (
    <output aria-label="theme">
      {preference}:{resolved}
    </output>
  );
}

/** A controllable `prefers-color-scheme: dark` media query. */
function mockSystem(dark: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: dark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => query),
  );
  return {
    set(next: boolean) {
      query.matches = next;
      listeners.forEach((l) => l());
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('theme', () => {
  it('follows the system setting by default and leaves <html> to the stylesheet', () => {
    const system = mockSystem(true);
    render(
      <ThemeProvider>
        <Resolved />
      </ThemeProvider>,
    );
    expect(screen.getByLabelText('theme')).toHaveTextContent('system:dark');
    expect(document.documentElement).not.toHaveAttribute('data-theme');

    act(() => system.set(false));
    expect(screen.getByLabelText('theme')).toHaveTextContent('system:light');
  });

  it('switches to a manual theme, writes data-theme and remembers it', async () => {
    mockSystem(false);
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeSelect />
        <Resolved />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(screen.getByLabelText('theme')).toHaveTextContent('dark:dark');
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');

    await user.click(screen.getByRole('radio', { name: 'Light' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');

    await user.click(screen.getByRole('radio', { name: 'System' }));
    expect(document.documentElement).not.toHaveAttribute('data-theme');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('restores a remembered choice on start', () => {
    mockSystem(false);
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    render(
      <ThemeProvider>
        <Resolved />
      </ThemeProvider>,
    );
    expect(screen.getByLabelText('theme')).toHaveTextContent('dark:dark');
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  });
});
