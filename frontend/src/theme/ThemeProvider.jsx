import { useCallback, useEffect, useMemo, useState } from 'react';
import { ACCENTS, ACCENT_KEY, THEMES, THEME_KEY, apply, readStored, resolve, store, watchSystem } from './theme';
import { ThemeContext } from './themeContext';

/**
 * Holds the reader's theme choice (paper, lamplight or system) and accent
 * (terracotta or sage, a reader setting with no control until C11), keeps
 * <html> in step, and follows the OS while the choice is 'system'.
 * index.html has already applied the stored values before first paint.
 */
export function ThemeProvider({ children }) {
  const [choice, setChoiceState] = useState(() => readStored(THEME_KEY, THEMES, 'system'));
  const [accent, setAccentState] = useState(() => readStored(ACCENT_KEY, ACCENTS, 'terracotta'));
  const [, setSystemTick] = useState(0); // re-render when the OS scheme changes
  const theme = resolve(choice);

  useEffect(() => {
    if (choice !== 'system') return undefined;
    return watchSystem(() => setSystemTick((n) => n + 1));
  }, [choice]);

  useEffect(() => {
    apply(theme, accent, { fade: true });
  }, [theme, accent]);

  const setChoice = useCallback((next) => {
    if (!THEMES.includes(next)) return;
    store(THEME_KEY, next);
    setChoiceState(next);
  }, []);

  const setAccent = useCallback((next) => {
    if (!ACCENTS.includes(next)) return;
    store(ACCENT_KEY, next);
    setAccentState(next);
  }, []);

  const value = useMemo(() => ({ choice, theme, accent, setChoice, setAccent }), [choice, theme, accent, setChoice, setAccent]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
