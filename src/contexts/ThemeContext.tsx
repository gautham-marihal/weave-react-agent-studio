import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { STYLE_KEY, accentKey, normalizeAccent, readAccent, readStyle, type PrefStore, type StyleId } from '../models/styles';

export type Theme = 'light' | 'dark' | 'system';
export type Density = 'comfortable' | 'compact';

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  density: Density;
  setDensity: (d: Density) => void;
  // the design style (Studio, Simple, Professional…) and its colour option, kept in this browser
  style: StyleId;
  setStyle: (s: StyleId) => void;
  accent: string;
  setAccent: (id: string) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

// localStorage, or nothing when the browser blocks it (the choice then lasts until the page closes)
function store(): PrefStore | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function save(key: string, value: string) {
  try {
    store()?.setItem(key, value);
  } catch {
    // storage unavailable
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = store()?.getItem('weave_theme') as Theme | null;
    return saved && ['light', 'dark', 'system'].includes(saved) ? saved : 'light';
  });

  const [density, setDensityState] = useState<Density>(() => {
    const saved = store()?.getItem('weave_density') as Density | null;
    return saved && ['comfortable', 'compact'].includes(saved) ? saved : 'comfortable';
  });

  const [style, setStyleState] = useState<StyleId>(() => readStyle(store()));
  const [accent, setAccentState] = useState<string>(() => readAccent(store(), readStyle(store())));

  const [systemPrefersDark, setSystemPrefersDark] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)').matches : false
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches);
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, []);

  // another tab changed the style or its colour: follow it
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STYLE_KEY && !e.key?.startsWith('weave_accent_')) return;
      const next = readStyle(store());
      setStyleState(next);
      setAccentState(readAccent(store(), next));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const resolvedTheme = useMemo<'light' | 'dark'>(() => {
    if (theme === 'system') return systemPrefersDark ? 'dark' : 'light';
    return theme;
  }, [theme, systemPrefersDark]);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', resolvedTheme);
    if (resolvedTheme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [resolvedTheme]);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-density', density);
  }, [density]);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-style', style);
    root.setAttribute('data-accent', accent);
  }, [style, accent]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    save('weave_theme', t);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      save('weave_theme', next);
      return next;
    });
  }, []);

  const setDensity = useCallback((d: Density) => {
    setDensityState(d);
    save('weave_density', d);
  }, []);

  // a style brings back the colour it was last left with
  const setStyle = useCallback((s: StyleId) => {
    setStyleState(s);
    setAccentState(readAccent(store(), s));
    save(STYLE_KEY, s);
  }, []);

  const setAccent = useCallback(
    (id: string) => {
      const next = normalizeAccent(style, id);
      setAccentState(next);
      save(accentKey(style), next);
    },
    [style]
  );

  const value = useMemo(
    () => ({
      theme,
      resolvedTheme,
      setTheme,
      toggleTheme,
      density,
      setDensity,
      style,
      setStyle,
      accent,
      setAccent,
    }),
    [theme, resolvedTheme, setTheme, toggleTheme, density, setDensity, style, setStyle, accent, setAccent]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
