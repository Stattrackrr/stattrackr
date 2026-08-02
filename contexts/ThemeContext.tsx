"use client";

import React, { createContext, useContext, useState, useEffect } from 'react';

type Theme = 'Light' | 'Dark';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('Dark');
  const [themeReady, setThemeReady] = useState(false);

  // Load theme from localStorage on mount (blocking script already applied class for first paint)
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as Theme | null;
    if (savedTheme === 'Light' || savedTheme === 'Dark') {
      setThemeState(savedTheme);
    }
    setThemeReady(true);
  }, []);

  // Apply theme to document root and persist only after initial load
  useEffect(() => {
    if (theme === 'Dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    if (themeReady) {
      localStorage.setItem('theme', theme);
    }
  }, [theme, themeReady]);

  const setTheme = (next: Theme) => {
    setThemeState(next);
  };

  const isDark = theme === 'Dark';

  return (
    <ThemeContext.Provider value={{ theme, setTheme, isDark }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    // Return default values if context is not available
    // This can happen during SSR, initial render, or if provider isn't mounted yet
    // The setTheme function is a no-op since there's no provider to update
    return { theme: 'Dark' as Theme, setTheme: () => {}, isDark: true };
  }
  return context;
}