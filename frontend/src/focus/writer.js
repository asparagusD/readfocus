/**
 * One writer per focus session across this browser's tabs (C23.8, FOCUS_RULES F3): the tab holding the lease
 * sends the session's events; another tab on the same session only shows the server's time. The lease lives in
 * localStorage and lapses after LEASE_MS without renewal (the writer closed, or hidden and so not beating), when
 * a visible tab takes it over. Without storage every tab may write; the server still counts time once.
 */
export const LEASE_MS = 75_000; // two and a half heartbeats

const keyOf = (sid) => `rf-focus-writer:${sid}`;

function read(storage, sid) {
  try {
    const lease = JSON.parse(storage?.getItem(keyOf(sid)) ?? 'null');
    return lease && typeof lease.tab === 'string' && Number.isFinite(lease.at) ? lease : null;
  } catch {
    return null;
  }
}

/** True when `tab` may write for session `sid` at `now`: it holds the lease, or the lease is free or lapsed. */
export function claim(storage, sid, tab, now) {
  if (!storage || !sid) return true;
  const lease = read(storage, sid);
  if (lease && lease.tab !== tab && now - lease.at < LEASE_MS) return false;
  try {
    storage.setItem(keyOf(sid), JSON.stringify({ tab, at: now }));
  } catch {
    return true; // storage refused: the server's limits still hold
  }
  return true;
}

/** Whether another tab holds a live lease on `sid` (for the read-only display), without taking it. */
export function heldElsewhere(storage, sid, tab, now) {
  const lease = read(storage, sid);
  return Boolean(lease && lease.tab !== tab && now - lease.at < LEASE_MS);
}

/** Gives the lease up when this tab holds it (the tab closing, or the session over). */
export function release(storage, sid, tab) {
  try {
    if (read(storage, sid)?.tab === tab) storage.removeItem(keyOf(sid));
  } catch {
    // nothing to give up
  }
}
