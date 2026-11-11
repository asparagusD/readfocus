import { createContext, useContext } from 'react';

export const ThemeContext = createContext(null);

/**
 * const { choice, theme, accent, setChoice, setAccent } = useTheme();
 * `choice` is 'paper' | 'lamplight' | 'system'; `theme` is what is drawn.
 */
export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme needs a ThemeProvider above it');
  return value;
}
