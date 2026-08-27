import { useState, useEffect, useCallback } from 'react';

export type Theme = 'dark' | 'light';

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const stored = localStorage.getItem('forexinsight_theme') as Theme | null;
      if (stored === 'dark' || stored === 'light') return stored;
      // Respect system preference
      if (typeof window !== 'undefined' && window.matchMedia) {
        return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
      }
    } catch {}
    return 'dark';
  });

  useEffect(() => {
    try {
      localStorage.setItem('forexinsight_theme', theme);
      // Apply class to html for potential CSS usage
      document.documentElement.setAttribute('data-theme', theme);
    } catch {}
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  return { theme, setTheme, toggleTheme };
}
