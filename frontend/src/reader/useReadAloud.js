import { useCallback, useEffect, useRef, useState } from 'react';
import { buildScript, locate } from './readAloud';
import { createSpeaker, pickVoice, readReadAloud, sortVoices, storeReadAloud } from './speech';

const FOLLOW_PAUSE_MS = 4000; // after the reader scrolls, the view is left alone this long
const MAX_EMPTY = 30; // pages or sections with nothing to read passed over in a row before it stops
const MOVES = new Set(['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' ']);
export const READ_WORD = 'rf-read-aloud'; // the CSS highlight on the word being spoken

export const readAloudSupported = () => Boolean(globalThis.speechSynthesis && globalThis.SpeechSynthesisUtterance);

/**
 * Read aloud (C40.2, issue 24, D1) over a book: the renderer's pages (or sections) read in turn with the system's
 * voices (speech.js), the word being spoken marked with the CSS highlight READ_WORD, and the view kept on it unless
 * the reader scrolled in the last few seconds. `source()` gives the renderer's readAloud: { count, runs(unit, skip),
 * range(ref, start, end), from(), show(unit), follow(rect), scroller() }; `skipOf(unit)` its region boxes (math,
 * code, figures, tables), a promise. Stops when the book closes.
 */
export function useReadAloud({ source, skipOf = () => Promise.resolve([]) }) {
  const [state, setState] = useState({ open: false, playing: false, unit: null, error: null, ended: false });
  const [settings, setSettings] = useState(readReadAloud);
  const [voices, setVoices] = useState([]);
  const speaker = useRef(null);
  const current = useRef(null); // { unit, runs, script }
  const session = useRef(0); // bumped by every start and stop: a page still loading for an old one is dropped
  const manual = useRef(0);
  const shown = useRef(null); // the unit last scrolled to for a word not drawn yet
  const settingsRef = useRef(settings);
  const voicesRef = useRef(voices);
  useEffect(() => { settingsRef.current = settings; voicesRef.current = voices; });

  useEffect(() => {
    const synth = globalThis.speechSynthesis;
    if (!synth) return undefined;
    const list = () => setVoices(sortVoices(synth.getVoices()));
    list();
    synth.addEventListener?.('voiceschanged', list);
    return () => synth.removeEventListener?.('voiceschanged', list);
  }, []);

  const unmark = () => globalThis.CSS?.highlights?.delete(READ_WORD);
  const mark = useCallback((ranges) => {
    const book = source();
    const here = current.current;
    if (!book || !here) return;
    const dom = ranges.map((r) => book.range(here.runs[r.run].ref, r.start, r.end)).filter(Boolean);
    if (!dom.length) {
      if (shown.current !== here.unit) { shown.current = here.unit; book.show(here.unit); } // its page is not drawn yet
      return;
    }
    if (globalThis.CSS?.highlights && globalThis.Highlight) CSS.highlights.set(READ_WORD, new Highlight(...dom));
    if (Date.now() - manual.current > FOLLOW_PAUSE_MS) book.follow(dom[0].getBoundingClientRect());
  }, [source]);

  const playUnit = useCallback(async function play(unit, place, empty = 0) {
    const book = source();
    const mine = session.current;
    if (!book || unit < 1 || unit > book.count) {
      setState((s) => ({ ...s, playing: false, ended: unit > (book?.count ?? 0) }));
      return;
    }
    let runs = [];
    try {
      runs = await book.runs(unit, await skipOf(unit).catch(() => []));
    } catch { /* an unreadable page reads as an empty one */ }
    if (mine !== session.current) return;
    const script = buildScript(runs);
    if (!script.paragraphs.length) {
      if (empty < MAX_EMPTY) play(unit + (place === 'last' ? -1 : 1), place === 'last' ? 'last' : null, empty + 1);
      else setState((s) => ({ ...s, playing: false }));
      return;
    }
    current.current = { unit, runs, script };
    const at = place === 'last' ? { p: script.paragraphs.length - 1, s: 0, c: 0 }
      : place ? locate(script, runs.findIndex((r) => r.ref.item === place.at?.item), place.offset) ?? { p: 0, s: 0, c: 0 }
        : { p: 0, s: 0, c: 0 };
    setState((s) => ({ ...s, playing: true, unit, error: null, ended: false }));
    speaker.current.play(script, at);
  }, [source, skipOf]);

  const ensureSpeaker = useCallback(() => {
    if (speaker.current) return speaker.current;
    speaker.current = createSpeaker({
      synth: globalThis.speechSynthesis,
      Utterance: globalThis.SpeechSynthesisUtterance,
      onWord: ({ ranges }) => mark(ranges),
      onEnd: (error) => {
        if (error) {
          unmark();
          setState((s) => ({ ...s, playing: false, error }));
        } else if (current.current) playUnit(current.current.unit + 1, null);
      },
    });
    const { voice, rate } = settingsRef.current;
    speaker.current.setRate(rate);
    speaker.current.setVoice(pickVoice(voicesRef.current, voice));
    return speaker.current;
  }, [mark, playUnit]);

  const start = useCallback(() => {
    const book = source();
    if (!book || !readAloudSupported()) return;
    ensureSpeaker();
    session.current += 1;
    shown.current = null;
    manual.current = 0;
    const from = book.from();
    setState({ open: true, playing: true, unit: from.unit, error: null, ended: false });
    playUnit(from.unit, from.at ? from : null);
  }, [source, ensureSpeaker, playUnit]);

  const stop = useCallback(() => {
    session.current += 1;
    speaker.current?.stop();
    current.current = null;
    unmark();
    setState({ open: false, playing: false, unit: null, error: null, ended: false });
  }, []);

  const pause = useCallback(() => {
    speaker.current?.pause();
    setState((s) => ({ ...s, playing: false }));
  }, []);
  const resume = useCallback(() => {
    if (!current.current || state.ended) { start(); return; }
    manual.current = 0; // pressing play brings the word back into view
    speaker.current?.resume();
    setState((s) => ({ ...s, playing: true, error: null }));
  }, [start, state.ended]);
  /** The next (1) or previous (-1) paragraph, onto the next or previous page past either end of this one. */
  const skip = useCallback((dir) => {
    const here = current.current;
    if (!here) return;
    manual.current = 0;
    session.current += 1;
    const place = speaker.current.place;
    if (dir < 0 && place?.p === 0 && here.unit > 1) {
      speaker.current.stop();
      playUnit(here.unit - 1, 'last');
    } else if (dir > 0 && place && place.p >= here.script.paragraphs.length - 1) {
      speaker.current.stop();
      playUnit(here.unit + 1, null);
    } else {
      speaker.current.skip(dir);
      setState((s) => ({ ...s, playing: true }));
    }
  }, [playUnit]);

  const choose = useCallback((next) => {
    const merged = { ...settingsRef.current, ...next };
    setSettings(merged);
    storeReadAloud(merged);
    if ('rate' in next) speaker.current?.setRate(merged.rate);
    if ('voice' in next) speaker.current?.setVoice(pickVoice(voicesRef.current, merged.voice));
  }, []);

  useEffect(() => { // the reader's own scrolling: the view stops following for a few seconds
    const el = state.open ? source()?.scroller() : null;
    if (!el) return undefined;
    const moved = () => { manual.current = Date.now(); };
    const key = (event) => { if (MOVES.has(event.key)) moved(); };
    el.addEventListener('wheel', moved, { passive: true });
    el.addEventListener('touchmove', moved, { passive: true });
    document.addEventListener('keydown', key);
    return () => {
      el.removeEventListener('wheel', moved);
      el.removeEventListener('touchmove', moved);
      document.removeEventListener('keydown', key);
    };
  }, [state.open, source]);

  useEffect(() => () => { // leaving the book stops the voice
    session.current += 1;
    speaker.current?.stop();
    unmark();
  }, []);

  return {
    supported: readAloudSupported(),
    ...state,
    voices,
    voice: pickVoice(voices, settings.voice),
    rate: settings.rate,
    start,
    stop,
    toggle: () => (state.open ? stop() : start()),
    pause,
    resume,
    skip,
    setRate: (rate) => choose({ rate }),
    setVoice: (voice) => choose({ voice }),
  };
}
