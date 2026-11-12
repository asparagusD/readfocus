import { useCallback, useEffect, useMemo, useState } from 'react';

/** The resolved theme and accent on <html> as "theme/accent" ('lamplight/terracotta'), following every change. */
export function useTheme() {
  const read = () => `${document.documentElement.dataset.theme ?? 'paper'}/${document.documentElement.dataset.accent ?? ''}`;
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-accent'] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

const KEY = 'rf-original-colours';
const EVENT = 'rf-original-colours'; // every user of the hook hears a change (toolbar and frame)

function readOriginal(bookId) {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}')[bookId] === true; } catch { return false; }
}

/** The per-book "show original colours" choice, kept in this browser (C17.4). */
export function useOriginalColours(bookId) {
  const [state, setState] = useState(() => ({ bookId, original: readOriginal(bookId) }));
  useEffect(() => {
    const sync = (event) => {
      if (!event.detail || event.detail.bookId === bookId) setState({ bookId, original: event.detail?.original ?? readOriginal(bookId) });
    };
    globalThis.addEventListener(EVENT, sync);
    return () => globalThis.removeEventListener(EVENT, sync);
  }, [bookId]);
  const original = state.bookId === bookId ? state.original : readOriginal(bookId);
  const toggle = useCallback(() => {
    const value = !original; // the shown state, so it works without storage too
    try {
      const all = JSON.parse(localStorage.getItem(KEY) ?? '{}');
      all[bookId] = value;
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch { /* not kept beyond this visit */ }
    globalThis.dispatchEvent(new CustomEvent(EVENT, { detail: { bookId, original: value } }));
  }, [bookId, original]);
  return [original, toggle];
}

/**
 * The colours a page is drawn in: null in Paper or with original colours on (the
 * publisher's own); in Lamplight the theme's page, text, link and code colours.
 */
export function useLamplight(bookId) {
  const themeKey = useTheme();
  const theme = themeKey.split('/')[0];
  const [original, toggleOriginal] = useOriginalColours(bookId);
  const colours = useMemo(() => {
    if (theme !== 'lamplight' || original) return null;
    const css = getComputedStyle(document.documentElement);
    const token = (name) => css.getPropertyValue(name).trim();
    return { background: token('--page'), foreground: token('--ink'), link: token('--accent-text'), code: token('--paper-2') };
  }, [themeKey, theme, original]); // eslint-disable-line react-hooks/exhaustive-deps -- themeKey changes the tokens read
  return { theme, colours, original, toggleOriginal };
}
