/**
 * Theme application.
 *
 * The palette lives in CSS custom properties on `:root` so that switching themes
 * is one attribute write instead of a re-render of every styled component. The
 * hook's only job is keeping that attribute and the browser chrome colour in
 * sync with the store.
 */

import { useEffect } from 'react';
import type { ThemeMode } from '../types';
import { useSessionStore } from '../store/sessionStore';

export interface ThemeState {
  readonly theme: ThemeMode;
  readonly isDark: boolean;
  toggle: () => void;
  set: (theme: ThemeMode) => void;
}

export function useTheme(): ThemeState {
  const theme = useSessionStore((state) => state.theme);
  const toggleTheme = useSessionStore((state) => state.toggleTheme);
  const setTheme = useSessionStore((state) => state.setTheme);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.style.colorScheme = theme;

    // Keeps the mobile browser's address bar in step with the app background.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta !== null) {
      meta.setAttribute('content', theme === 'dark' ? '#0f172a' : '#f8fafc');
    }
  }, [theme]);

  return { theme, isDark: theme === 'dark', toggle: toggleTheme, set: setTheme };
}
