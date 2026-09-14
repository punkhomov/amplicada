import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'amplicada-theme';

function getSystemTheme(): ResolvedTheme {
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

function getInitialTheme(): Theme {
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  }
  return 'system';
}

function applyTheme(resolved: ResolvedTheme) {
  document.documentElement.classList.toggle('dark', resolved === 'dark');
}

export interface UseThemeResult {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

export function useTheme(): UseThemeResult {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme);

  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = (e: MediaQueryListEvent) => setSystemTheme(e.matches ? 'dark' : 'light');
    mql.addEventListener('change', listener);
    return () => mql.removeEventListener('change', listener);
  }, []);

  const resolvedTheme = theme === 'system' ? systemTheme : theme;

  useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore storage errors */
    }
  }, [theme]);

  const setTheme = useCallback((next: Theme) => setThemeState(next), []);

  return { theme, resolvedTheme, setTheme };
}
