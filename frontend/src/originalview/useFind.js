import { useCallback, useEffect, useMemo, useState } from 'react';
import { findPattern, findStatus, stepMatch } from './find';

/**
 * Find in the book (C38.5, issue 22), for the renderer behind `book` (its search, stopSearch and showMatch): whether
 * the bar is open, the query (kept when the bar closes, as Edge keeps it), the matches found so far and the one shown.
 * A query is searched 150 ms after the last key; the first match from the page in view on is shown first; next and
 * previous go round the book. `focusKey` changes each time the bar is asked for, so it takes focus again.
 */
export function useFind(book) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState(null); // { query, matches, current, done, step }
  const [focusKey, setFocusKey] = useState(0);

  useEffect(() => {
    if (!open) return undefined;
    if (!findPattern(query)) { // a blank query: nothing searched, and older matches are not shown (`mine`)
      book.current?.stopSearch?.();
      return undefined;
    }
    const timer = setTimeout(() => {
      book.current?.search?.(query, ({ matches, first, done }) => setFound((prev) => ({
        query, matches, done, current: prev?.query === query && prev.current ? prev.current : first, step: prev?.step ?? 0,
      })));
    }, 150);
    return () => clearTimeout(timer);
  }, [open, query, book]);

  // The match shown is scrolled to when it changes, or when next or previous lands on it again (a single match).
  const current = found?.current ?? null;
  const step = found?.step ?? 0;
  useEffect(() => { if (current) book.current?.showMatch?.(current); }, [current, step, book]);

  const move = useCallback((dir) => setFound((prev) => {
    if (!prev?.matches.length) return prev;
    const index = stepMatch(prev.matches.indexOf(prev.current), prev.matches.length, dir);
    return { ...prev, current: prev.matches[index], step: (prev.step ?? 0) + 1 };
  }), []);
  const openFind = useCallback(() => {
    setOpen(true);
    setFocusKey((n) => n + 1);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    setFound(null);
    book.current?.stopSearch?.();
  }, [book]);

  const mine = open && found?.query === query ? found : null; // matches for an older query are not shown
  const count = mine?.matches.length ?? 0;
  const matches = mine?.matches ?? null;
  const shown = mine?.current ?? null;
  const highlighted = useMemo(() => (matches ? { matches, current: shown } : null), [matches, shown]); // one object a change
  return {
    open, query, setQuery, openFind, close, focusKey,
    next: () => move(1),
    prev: () => move(-1),
    count,
    found: highlighted,
    status: findStatus({ query, count, index: mine ? mine.matches.indexOf(mine.current) : -1, done: Boolean(mine?.done) }),
    done: Boolean(mine?.done),
  };
}
