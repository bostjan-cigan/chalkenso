'use client';

import { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';

interface ThemeContextType {
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('system');
  const [mounted, setMounted] = useState(false);

  // Get the resolved theme (system preference or manual override)
  const getResolvedTheme = (currentTheme: Theme): 'light' | 'dark' => {
    if (currentTheme === 'system') {
      if (typeof window === 'undefined') return 'dark';
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      return prefersDark ? 'dark' : 'light';
    }
    return currentTheme;
  };

  useEffect(() => {
    setMounted(true);
    
    // Check if user has manually set a preference
    const savedTheme = localStorage.getItem('theme') as Theme | null;
    if (savedTheme && (savedTheme === 'light' || savedTheme === 'dark')) {
      setTheme(savedTheme);
      document.documentElement.setAttribute('data-theme', savedTheme);
    } else {
      // Use system preference
      setTheme('system');
      const resolvedTheme = getResolvedTheme('system');
      document.documentElement.setAttribute('data-theme', resolvedTheme);
    }

    // Listen for system theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      const currentTheme = localStorage.getItem('theme') as Theme | null;
      if (!currentTheme || currentTheme === 'system') {
        // Temporarily disable transitions during system theme change
        document.documentElement.classList.add('theme-transitioning');
        
        setTheme('system');
        const resolvedTheme = getResolvedTheme('system');
        document.documentElement.setAttribute('data-theme', resolvedTheme);
        
        // Re-enable transitions after theme change is complete
        requestAnimationFrame(() => {
          setTimeout(() => {
            document.documentElement.classList.remove('theme-transitioning');
          }, 0);
        });
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const toggleTheme = () => {
    let newTheme: Theme;
    const currentTheme = theme;
    
    if (currentTheme === 'system') {
      // If currently on system, switch to opposite of current resolved theme
      const currentResolved = getResolvedTheme('system');
      newTheme = currentResolved === 'dark' ? 'light' : 'dark';
    } else {
      // If user has manually set, toggle between light and dark
      newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    }
    
    // Temporarily disable transitions during theme change
    document.documentElement.classList.add('theme-transitioning');
    
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
    
    // Re-enable transitions after theme change is complete
    requestAnimationFrame(() => {
      setTimeout(() => {
        document.documentElement.classList.remove('theme-transitioning');
      }, 0);
    });
  };

  const resolvedTheme = getResolvedTheme(theme);

  // Always provide the context, even before mounting
  // This prevents the "must be used within a ThemeProvider" error
  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
