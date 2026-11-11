// In-place lookup, client side (C12.8): a small cache over GET /lookup, the hover setting,
// and what the word card shows for an answer. No DOM here, so node --test covers it.
import { lookupPath } from './wordAt.js';

export const CACHE_TERMS = 300;

const keyOf = ({ term, proper }) => (proper ? `P:${term}` : `w:${term.toLowerCase()}`);

/**
 * A client for GET /lookup with an LRU of recent answers for the session. Only one lookup is in
 * flight at a time: a new term aborts the older request (AbortController), which resolves as
 * { status: 'aborted' }. Errors and "unavailable" answers are not kept, so the next hover asks again.
 */
export function createLookupClient(api, { size = CACHE_TERMS, lang = 'en' } = {}) {
  const cache = new Map(); // key -> data, oldest first
  const inFlight = new Map(); // key -> { promise, controller }

  function remember(key, data) {
    cache.delete(key);
    cache.set(key, data);
    while (cache.size > size) cache.delete(cache.keys().next().value);
  }

  function get(target) {
    const key = keyOf(target);
    if (cache.has(key)) {
      const data = cache.get(key);
      remember(key, data); // most recent again
      return Promise.resolve({ status: 'ready', data });
    }
    if (inFlight.has(key)) return inFlight.get(key).promise;
    for (const [other, { controller }] of inFlight) { // stale: the reader has moved on
      controller.abort();
      inFlight.delete(other);
    }
    const controller = new AbortController();
    const term = target.proper ? target.term : target.term.toLowerCase();
    const promise = api(lookupPath({ term, proper: target.proper }, lang), { signal: controller.signal })
      .then((data) => {
        if (!data?.unavailable) remember(key, data);
        return { status: 'ready', data };
      })
      .catch((error) => (controller.signal.aborted || error?.name === 'AbortError'
        ? { status: 'aborted' }
        : { status: 'error', message: error?.message || "We couldn't look this up right now." }))
      .finally(() => {
        if (inFlight.get(key)?.controller === controller) inFlight.delete(key);
      });
    inFlight.set(key, { promise, controller });
    return promise;
  }

  return { get };
}

const settingKey = (userId) => `rf-lookup-hover:${userId ?? 'anon'}`;

/** Hover lookup on or off for this user on this device; on unless they turned it off. */
export function readLookupOn(userId, storage = globalThis.localStorage) {
  try {
    return storage?.getItem(settingKey(userId)) !== 'off';
  } catch {
    return true;
  }
}

export function storeLookupOn(userId, on, storage = globalThis.localStorage) {
  try {
    storage?.setItem(settingKey(userId), on ? 'on' : 'off');
  } catch {
    // Not kept; the choice still applies for this visit.
  }
}

/** What the card shows for a lookup state ({status, data|message}) and its target. */
export function cardContent(state, target) {
  const term = target.term;
  if (state.status === 'loading') return { kind: 'loading', title: term, announce: '' };
  if (state.status === 'error') {
    return { kind: 'unavailable', title: term, message: state.message, announce: `Couldn't look up ${term}: ${state.message}` };
  }
  const data = state.data ?? {};
  if (data.unavailable) {
    return { kind: 'unavailable', title: term, message: data.message, announce: `Couldn't look up ${term}: ${data.message}` };
  }
  if (data.ambiguous) {
    return { kind: 'ambiguous', title: term, url: data.url, announce: `${term} could mean several things.` };
  }
  if (data.wiki) {
    const { title, description = null, extract, url } = data.wiki;
    return { kind: 'summary', title, description, extract, url, announce: `${title}: ${extract}` };
  }
  const first = data.meanings?.[0];
  if (first) {
    const senses = first.definitions.slice(0, 2);
    return {
      kind: 'definition', title: data.term, phonetic: data.phonetic ?? null, pos: first.part_of_speech, senses,
      example: first.example ?? null, announce: `${data.term}, ${first.part_of_speech}: ${senses[0]}`,
    };
  }
  return { kind: 'none', title: term, phrase: target.kind === 'phrase', announce: `No definition found for ${term}.` };
}
