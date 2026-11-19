// C35.5a (issue 20): each page's last data, shown at once when the reader comes back, refreshed behind it
// ("stale while revalidate"). Before, every visit to the Library, Dashboard or League fetched again and showed an
// empty page until the answer came (0.4 to 1.6 s on production, coming straight back included).
//
// Kept in memory only, for this tab, per request path; a request already on its way is shared, not sent twice.
// Signing out forgets everything (useAuth), so no reader's data is shown to the next.

import { useCallback, useEffect, useState } from 'react';

const kept = new Map(); // path -> data
const keptAt = new Map(); // path -> when its data arrived (ms)
const asked = new Map(); // path -> promise of the answer under way
const fetchPath = (path) => import('./api').then((mod) => mod.fetchApi(path)); // already loaded in the app

/** The last data kept for `path`, or undefined. */
export function cached(path) {
  return kept.get(path);
}

/** Keep `data` as `path`'s latest (a page that changed it itself: an upload, a removal, a saved setting). */
export function remember(path, data, { now = Date.now } = {}) {
  kept.set(path, data);
  keptAt.set(path, now());
}

/**
 * GET `path`: one request at a time per path; its answer is kept. A failure keeps the old data. With `fresh`
 * (ms), kept data younger than that is the answer and nothing is asked (the header's /me/progress for League's
 * settings, a moment later).
 */
export function load(path, { api = fetchPath, fresh = 0, now = Date.now } = {}) {
  if (fresh > 0 && kept.has(path) && now() - keptAt.get(path) < fresh) return Promise.resolve(kept.get(path));
  if (!asked.has(path)) {
    const promise = api(path)
      .then((data) => { remember(path, data, { now }); return data; })
      .finally(() => asked.delete(path));
    asked.set(path, promise);
  }
  return asked.get(path);
}

/** Forget every page's data (signing out). */
export function forgetPageData() {
  kept.clear();
  keptAt.clear();
  asked.clear();
}

/**
 * `{ data, error, loading, reload }` for GET `path`: the kept data at once (loading false) when there is some, then
 * the fresh answer; `error` only when there is nothing to show. `path` null asks nothing.
 */
export function usePageData(path, { api } = {}) {
  const [state, setState] = useState(() => ({ path, data: path ? cached(path) : undefined, error: null }));
  const [attempt, setAttempt] = useState(0);
  const current = state.path === path ? state : { path, data: path ? cached(path) : undefined, error: null };
  useEffect(() => {
    if (!path) return undefined;
    let live = true;
    load(path, { api }).then(
      (data) => { if (live) setState({ path, data, error: null }); },
      (error) => { if (live) setState({ path, data: cached(path), error }); },
    );
    return () => { live = false; };
  }, [path, api, attempt]);
  const reload = useCallback(() => {
    setState((s) => ({ ...s, error: null }));
    setAttempt((n) => n + 1);
  }, []);
  const shown = current.data;
  return {
    data: shown,
    error: shown === undefined ? current.error : null,
    loading: shown === undefined && !current.error,
    reload,
  };
}
