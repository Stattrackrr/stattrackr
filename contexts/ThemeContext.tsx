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
  const [theme, setTheme] = useState<Theme>('Dark');

  // Load theme from localStorage on mount
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as Theme;
    if (savedTheme && (savedTheme === 'Light' || savedTheme === 'Dark')) {
      setTheme(savedTheme);
    }
  }, []);

  // Apply theme to document root and save to localStorage
  useEffect(() => {
    if (theme === 'Dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    
    // Save theme to localStorage whenever it changes
    localStorage.setItem('theme', theme);
  }, [theme]);

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