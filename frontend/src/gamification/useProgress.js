import { useEffect, useState } from 'react';
import { fetchApi } from '../lib/api';

/**
 * The reader's progress from GET /me/progress (C24.5): null until it arrives, and null for good if it fails
 * (the header then shows nothing rather than an error; the Dashboard has its own states). Asks only when `enabled`
 * (a signed-in reader): a signed-out request would be a 401, which signs the visitor out and sends them to /login.
 */
export function useProgress(enabled = true) {
  const [progress, setProgress] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    fetchApi('/me/progress').then((body) => { if (live) setProgress(body); }).catch(() => {});
    return () => { live = false; };
  }, [enabled]);
  return enabled ? progress : null;
}
