import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/** What the user chose: follow the system, or always light / dark. */
export type ThemePreference = 'system' | 'light' | 'dark';
/** What is on screen now. */
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'offerpath.theme';

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const DARK_QUERY = '(prefers-color-scheme: dark)';

function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

function readPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

/**
 * Light and dark themes through CSS custom properties.
 *
 * Follows the system setting unless the user picks one; a manual pick is
 * remembered and written to `<html data-theme>`, which styles.css reads.
 * "System" removes the attribute so the stylesheet's media query decides.
 */
export function ThemeProvider({
  children,
  defaultPreference,
}: {
  children: ReactNode;
  /** Overrides the stored preference (tests, previews). */
  defaultPreference?: ThemePreference;
}) {
  const [preference, setPreferenceState] = useState<ThemePreference>(
    () => defaultPreference ?? readPreference(),
  );
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(DARK_QUERY);
    const onChange = () => setSystem(query.matches ? 'dark' : 'light');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (preference === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', preference);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    try {
      if (next === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY);
      else window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage unavailable: the choice lasts for this session.
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      resolved: preference === 'system' ? system : preference,
      setPreference,
    }),
    [preference, system, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // Outside a provider: report the system theme and ignore changes.
    return { preference: 'system', resolved: systemTheme(), setPreference: () => undefined };
  }
  return ctx;
}
