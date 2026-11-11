// Theme state (C10.6): the reader's choice of 'paper' (light),
// 'lamplight' (dark) or 'system', stored in localStorage. The inline
// script in index.html repeats resolve/apply before first paint; keep the
// key names and defaults in step with it.

export const THEME_KEY = 'rf-theme';
export const ACCENT_KEY = 'rf-accent';
export const THEMES = ['paper', 'lamplight', 'system'];
export const ACCENTS = ['terracotta', 'sage'];

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

export function readStored(key, allowed, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return allowed.includes(value) ? value : fallback;
  } catch {
    return fallback; // storage blocked (private mode, policy)
  }
}

export function store(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not persisted; the choice still applies for this visit.
  }
}

/** The theme actually drawn: 'system' follows the OS colour scheme. */
export function resolve(choice) {
  if (choice !== 'system') return choice;
  return darkQuery().matches ? 'lamplight' : 'paper';
}

export function watchSystem(onChange) {
  const query = darkQuery();
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/**
 * Sets data-theme and data-accent on <html>. With `fade`, the whole page
 * cross-fades over --dur-3 (View Transitions, base.css); skipped under
 * reduced motion or where the browser has no View Transitions.
 */
export function apply(theme, accent, { fade = false } = {}) {
  const root = document.documentElement;
  const set = () => {
    root.dataset.theme = theme;
    root.dataset.accent = accent;
  };
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (fade && !reduced && typeof document.startViewTransition === 'function'
    && (root.dataset.theme !== theme || root.dataset.accent !== accent)) {
    document.startViewTransition(set);
  } else {
    set();
  }
}
