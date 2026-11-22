/**
 * Read aloud's voice (C40.1, issue 24, D1): the system's voices through the Web Speech API, the reader's voice and
 * speed kept on this device, and a speaker that plays a script (readAloud.js) one sentence at a time.
 *
 * Pause is a cancel that remembers the last word spoken, and resume speaks again from that word: Chromium's own
 * pause and resume do nothing for some voices (the online natural ones among them), and a speed or voice change
 * needs the same restart. Callbacks of a cancelled utterance (Chromium still sends its end) are ignored.
 */
import { wordAt } from './readAloud.js';

export const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
export const DEFAULT_READ_ALOUD = { voice: null, rate: 1 };
const KEY = 'rf-read-aloud';

/** The reader's voice (a voiceURI, or null for the first of sortVoices) and speed; the defaults when nothing or nonsense is stored. */
export function readReadAloud(store = globalThis.localStorage) {
  try {
    const stored = JSON.parse(store?.getItem(KEY) ?? 'null');
    return {
      voice: typeof stored?.voice === 'string' && stored.voice ? stored.voice : null,
      rate: RATES.includes(stored?.rate) ? stored.rate : DEFAULT_READ_ALOUD.rate,
    };
  } catch {
    return { ...DEFAULT_READ_ALOUD };
  }
}
export function storeReadAloud(settings, store = globalThis.localStorage) {
  try { store?.setItem(KEY, JSON.stringify(settings)); } catch { /* private mode: the defaults come back next time */ }
}

/** The next speed up (dir 1) or down (-1), stopping at 0.5x and 2x. */
export function stepRate(rate, dir) {
  const at = RATES.indexOf(rate);
  return RATES[Math.min(RATES.length - 1, Math.max(0, (at < 0 ? RATES.indexOf(1) : at) + dir))];
}

const english = (v) => /^en\b/i.test(v.lang ?? '');
const natural = (v) => /natural/i.test(v.name ?? '');
const rank = (v) => (english(v) ? 0 : 4) + (natural(v) ? 0 : 2) + (v.default ? 0 : 1);

/** English voices first, natural ones (Edge's online voices) first among them, then the system's default; by name after that. */
export const sortVoices = (voices) => [...(voices ?? [])].sort((a, b) => rank(a) - rank(b) || (a.name ?? '').localeCompare(b.name ?? ''));

/** The stored voice when the system still has it, else the first of sortVoices; null with no voices. */
export const pickVoice = (voices, uri) => (voices ?? []).find((v) => v.voiceURI === uri) ?? sortVoices(voices)[0] ?? null;

/** "Aria (Natural) - English (United States)" for "Microsoft Aria Online (Natural) - English (United States)". */
export const voiceLabel = (voice) => (voice?.name ?? '').replace(/^Microsoft\s+/, '').replace(/\s+Online\b/, '').trim();

/**
 * A speaker over `synth` (window.speechSynthesis) and `Utterance` (SpeechSynthesisUtterance). `onWord({ p, s,
 * ranges })` names each word as it is spoken (readAloud.wordAt's ranges); `onSentence({ p, s })` each sentence as it
 * starts; `onEnd(error)` when the script runs out (no error) or the voice fails.
 */
export function createSpeaker({ synth, Utterance, onWord = () => {}, onSentence = () => {}, onEnd = () => {} }) {
  let script = null;
  let at = null; // { p, s, from }: the sentence, and where in it the utterance began
  let spoken = 0; // the last word's start in the utterance
  let token = 0; // bumped by every cancel: an old utterance's events are ignored
  let playing = false;
  let voice = null;
  let rate = 1;

  const sentence = () => script?.paragraphs[at.p]?.sentences[at.s];

  function speak() {
    token += 1;
    synth.cancel();
    const current = sentence();
    if (!current) { playing = false; onEnd(); return; }
    const mine = token;
    spoken = 0;
    const u = new Utterance(current.text.slice(at.from));
    if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'en';
    u.rate = rate;
    u.onboundary = (event) => {
      if (mine !== token || (event.name && event.name !== 'word')) return;
      spoken = event.charIndex;
      onWord({ p: at.p, s: at.s, ranges: wordAt(current, event.charIndex, event.charLength, at.from) });
    };
    u.onend = () => {
      if (mine !== token) return;
      const { paragraphs } = script;
      at = at.s + 1 < paragraphs[at.p].sentences.length ? { p: at.p, s: at.s + 1, from: 0 } : { p: at.p + 1, s: 0, from: 0 };
      speak();
    };
    u.onerror = (event) => {
      if (mine !== token || event.error === 'interrupted' || event.error === 'canceled') return;
      token += 1;
      playing = false;
      onEnd(event.error || 'error');
    };
    playing = true;
    onSentence({ p: at.p, s: at.s });
    synth.speak(u);
  }

  const halt = () => { token += 1; synth.cancel(); };
  const restart = () => { if (playing) { at = { ...at, from: at.from + spoken }; speak(); } };

  return {
    /** Starts `next` at { p, s, c } (readAloud.locate's place; the start when left out). */
    play(next, place = { p: 0, s: 0, c: 0 }) {
      script = next;
      at = { p: place.p, s: place.s, from: place.c ?? 0 };
      speak();
    },
    pause() { if (playing) { halt(); playing = false; at = { ...at, from: at.from + spoken }; spoken = 0; } },
    resume() { if (!playing && script && at) speak(); },
    stop() { halt(); playing = false; script = null; at = null; },
    /** The next or previous paragraph (dir 1 or -1), from its start; the previous of the first is its own start. */
    skip(dir) {
      if (!script || !at) return;
      const p = Math.min(script.paragraphs.length, Math.max(0, at.p + dir));
      at = { p, s: 0, from: 0 };
      speak();
    },
    setRate(next) { rate = next; restart(); },
    setVoice(next) { voice = next; restart(); },
    get playing() { return playing; },
    get place() { return at && { p: at.p, s: at.s }; },
  };
}
