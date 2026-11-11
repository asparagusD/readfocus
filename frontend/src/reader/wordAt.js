// Pure word rules for in-place lookup (C12.7): which word an offset falls in, whether it is
// worth looking up, whether it names something, and whether a selection is a phrase.
// No DOM here, so node --test covers it; useWordAtPoint.js does the DOM side.

export const MIN_LETTERS = 3;
export const MAX_PHRASE_WORDS = 5;
export const MAX_TERM_CHARS = 60; // the backend's limit (backend/services/lookup.py)

// Common English function words: never worth a definition.
const STOPWORDS = new Set(`
  about above after again against all also although among and another any are around because been before being
  below beneath beside besides between both but can cannot could did does doing down during each either else
  enough even ever every few for from further had has have having her hers herself him himself his how however
  into its itself just least less many may might mine more most much must myself neither never nor not now off
  once only onto other others otherwise ought our ours ourselves out over own per rather same shall she should
  since some such than that the their theirs them themselves then there therefore these they this those though
  through thus till too toward towards under unless until upon very was were what whatever when whenever where
  whereas whether which while who whoever whom whose why will with within without would yet you your yours
  yourself yourselves one two three its it's i'm i've i'd i'll you're we're they're that's there's what's let's
  don't doesn't didn't isn't aren't wasn't weren't can't couldn't won't wouldn't shouldn't hasn't haven't hadn't
`.trim().split(/\s+/));

const segmenters = new Map();
function segmenter(lang) {
  if (!segmenters.has(lang)) segmenters.set(lang, new Intl.Segmenter(lang, { granularity: 'word' }));
  return segmenters.get(lang);
}

const HYPHENS = new Set(['-', '‐', '‑']);

/** The word-like runs of text, with a hyphenated compound ("well-known") kept as one word. */
export function words(text, lang = 'en') {
  const out = [];
  let joinNext = false;
  for (const { segment, index, isWordLike } of segmenter(lang).segment(text)) {
    if (isWordLike) {
      const last = out.at(-1);
      if (joinNext && last) {
        last.end = index + segment.length;
        last.word = text.slice(last.start, last.end);
      } else {
        out.push({ word: segment, start: index, end: index + segment.length });
      }
      joinNext = false;
    } else {
      const last = out.at(-1);
      joinNext = HYPHENS.has(segment) && last?.end === index;
    }
  }
  return out;
}

/** The word containing offset in text, or null when the offset is on a space or punctuation. */
export function wordAround(text, offset, lang = 'en') {
  return words(text, lang).find((w) => offset >= w.start && offset < w.end) ?? null;
}

const lettersIn = (word) => (word.match(/\p{L}/gu) ?? []).length;

/** Worth looking up: at least three letters, no digits, not a stopword (English list only). */
export function eligible(word, lang = 'en') {
  if (!word || /\p{N}/u.test(word) || lettersIn(word) < MIN_LETTERS) return false;
  if (lang.startsWith('en') && STOPWORDS.has(word.toLowerCase().replace(/’/g, "'"))) return false;
  return true;
}

/** True when the text before a word ends a sentence (or is empty): a capital there proves nothing. */
export function sentenceInitial(before) {
  const trimmed = before.replace(/[\s"“”‘’'([«]+$/u, '');
  return trimmed === '' || /[.!?:…]$/u.test(trimmed);
}

const capitalised = (word) => /^\p{Lu}/u.test(word);

/** A proper noun: capitalised and not at the start of a sentence. */
export function isProperNoun(word, before) {
  return capitalised(word) && !sentenceInitial(before);
}

/** A selection as a phrase lookup: 2 to 5 words, edge punctuation trimmed; null otherwise. */
export function phraseOf(selected, lang = 'en') {
  const term = (selected ?? '').replace(/\s+/g, ' ').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  const found = words(term, lang);
  if (found.length < 2 || found.length > MAX_PHRASE_WORDS || term.length > MAX_TERM_CHARS) return null;
  const named = found.filter((w) => eligible(w.word, lang));
  return { term, words: found.length, proper: named.length > 0 && named.every((w) => capitalised(w.word)) };
}

/** The backend request for a target: GET /lookup, with proper=1 for a name so Wikipedia is asked first. */
export function lookupPath({ term, proper }, lang = 'en') {
  const query = new URLSearchParams({ term, lang });
  if (proper) query.set('proper', '1');
  return `/lookup?${query}`;
}
