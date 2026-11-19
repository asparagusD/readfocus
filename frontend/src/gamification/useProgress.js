import { useEffect, useState } from 'react';
import { fetchApi } from '../lib/api';
import { cached, load, remember } from '../lib/pageData';
import { deviceZone, zoneToAdopt } from './progressMath';

/**
 * The reader's progress from GET /me/progress (C24.5): null until it arrives, and null for good if it fails
 * (the header then shows nothing rather than an error; the Dashboard has its own states). Asks only when `enabled`
 * (a signed-in reader): a signed-out request would be a 401, which signs the visitor out and sends them to /login.
 *
 * C24 (GAMIFICATION G6): with `adoptZone` (the header, on every page), while the stored zone is still the default UTC
 * this device's zone is saved once (`zoneToAdopt`), so the daily goal and the streak follow the reader's own calendar
 * days. A refusal changes nothing.
 */
export const PROGRESS_FRESH_MS = 5000; // C35.5c: an answer this young is shared, not asked again

export function useProgress(enabled = true, { adoptZone = false } = {}) {
  // C35.5c (issue 20): the header's answer is shared (one request per moment, pageData), so League's settings
  // show at once from it and a return to any page shows the last progress while it is asked again.
  const [progress, setProgress] = useState(() => cached('/me/progress') ?? null);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    load('/me/progress', { fresh: PROGRESS_FRESH_MS }).then((body) => {
      if (!live) return;
      setProgress(body);
      const zone = adoptZone && zoneToAdopt(body.timezone, deviceZone());
      if (!zone) return;
      fetchApi('/me/progress', { method: 'PUT', body: JSON.stringify({ timezone: zone }) })
        .then((next) => { remember('/me/progress', next); if (live) setProgress(next); })
        .catch(() => {});
    }).catch(() => {});
    return () => { live = false; };
  }, [enabled, adoptZone]);
  return enabled ? progress : null;
}
