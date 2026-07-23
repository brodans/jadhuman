import { useState, useEffect } from 'react';

export function useDarkMode() {
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window === 'undefined') return false;
    const saved = localStorage.getItem('theme');
    if (saved) return saved === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    const root = window.document.documentElement;
    const metaThemeColor = document.getElementById('theme-color-meta') || document.querySelector('meta[name="theme-color"]');
    
    if (isDarkMode) {
      root.classList.add('dark');
      root.classList.remove('light');
      localStorage.setItem('theme', 'dark');
      if (metaThemeColor) metaThemeColor.setAttribute('content', '#1e293b');
    } else {
      root.classList.add('light');
      root.classList.remove('dark');
      localStorage.setItem('theme', 'light');
      if (metaThemeColor) metaThemeColor.setAttribute('content', '#ffffff');
    }
  }, [isDarkMode]);

  const toggleDarkMode = () => setIsDarkMode(prev => !prev);

  return { isDarkMode, toggleDarkMode };
}
