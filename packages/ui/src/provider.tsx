import type { ReactNode } from 'react';

import { Toaster } from './components/Toast';
import { ThemeProvider, type ThemePreference } from './theme';

/** Theme and toasts for an app's root. */
export function UiProvider({
  children,
  defaultTheme,
}: {
  children: ReactNode;
  defaultTheme?: ThemePreference;
}) {
  return (
    <ThemeProvider defaultPreference={defaultTheme}>
      {children}
      <Toaster />
    </ThemeProvider>
  );
}
