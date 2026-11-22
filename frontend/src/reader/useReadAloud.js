import { useCallback, useEffect, useRef, useState } from 'react';
import { buildScript, locate } from './readAloud';
import { createSpeaker, pickVoice, readReadAloud, sortVoices, storeReadAloud } from './speech';

const FOLLOW_PAUSE_MS = 4000; // after the reader scrolls, the view is left alone this long
const OWN_MOVE_MS = 700; // a move of the place this soon after read aloud moved the view is its own, not the reader's
const MAX_EMPTY = 30; // pages or sections with nothing to read passed over in a row before it stops
const MOVES = new Set(['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' ']);
export const READ_WORD = 'rf-read-aloud'; // the CSS highlight on the word being spoken

export const readAloudSupported = () => Boolean(globalThis.speechSynthesis && globalThis.SpeechSynthesisUtterance);

/** Takes the mark off the spoken word in every window holding it. */
function unpaint(painted) {
  for (const win of painted) { try { win.CSS.highlights.delete(READ_WORD); } catch { /* its document is gone */ } }
  painted.clear();
}

/** Marks `dom` (ranges) in their own windows' registries; a section's iframe gets the rule in the page's --read-word. */
function paintWord(painted, dom) {
  const byWin = new Map();
  for (const range of dom) {
    const win = range.startContainer.ownerDocument?.defaultView;
    if (win?.CSS?.highlights && typeof win.Highlight === 'function') byWin.set(win, [...(byWin.get(win) ?? []), range]);
  }
  unpaint(painted);
  for (const [win, list] of byWin) {
    const doc = win.document;
    if (win !== globalThis.window && !doc.head?.querySelector('style[data-rf-read]')) {
      const style = doc.createElement('style');
      style.setAttribute('data-rf-read', '');
      style.textContent = `::highlight(${READ_WORD}) { background-color: ${getComputedStyle(document.documentElement).getPropertyValue('--read-word').trim()}; }`;
      doc.head?.append(style);
    }
    win.CSS.highlights.set(READ_WORD, new win.Highlight(...list));
    painted.add(win);
  }
}

/**
 * Read aloud (C40.2, issue 24, D1) over a book: the renderer's pages (or sections) read in turn with the system's
 * voices (speech.js), the word being spoken marked with the CSS highlight READ_WORD, and the view kept on it unless
 * the reader scrolled in the last few seconds. `source()` gives the renderer's readAloud: { count, runs(unit, skip),
 * range(ref, start, end), from(), show(unit), follow(rect), scroller() }; `skipOf(unit)` its region boxes (math,
 * code, figures, tables), a promise. Stops when the book closes.
 * C40.3 (issue 24): an EPUB's sections too. A word is marked in its own document's highlight registry (a section's
 * iframe gets the ::highlight rule in the page's --read-word); `runOf(runs, at, offset)` on the source finds where a
 * start place falls among its runs (a PDF's runs match by item); `scroller()` is optional, and `moved()`, called on
 * every change of place, counts as the reader's scrolling unless read aloud has just moved the view itself.
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

  const painted = useRef(new Set()); // the windows (the page's, a section's) holding the mark
  const own = useRef(0); // when read aloud last moved the view
  const unmark = () => unpaint(painted.current);
  const mark = useCallback((ranges) => {
    const book = source();
    const here = current.current;
    if (!book || !here) return;
    const dom = ranges.map((r) => book.range(here.runs[r.run].ref, r.start, r.end)).filter(Boolean);
    const following = Date.now() - manual.current > FOLLOW_PAUSE_MS;
    if (!dom.length) { // its page or section is not drawn: brought back once, unless the reader has just moved away
      if (following && shown.current !== here.unit) { shown.current = here.unit; own.current = Date.now(); book.show(here.unit); }
      return;
    }
    paintWord(painted.current, dom);
    if (following) { own.current = Date.now(); book.follow(dom[0].getBoundingClientRect(), dom[0]); }
  }, [source]);

  const playUnit = useCallback(async function play(unit, place, empty = 0) {
    const book = source();
    const mine = session.current;
    if (!book || unit < 1 || unit > book.count) {
      setState((s) => ({ ...s, playing: false, ended: unit > (book?.count ?? 0) }));
      return;
    }
    let runs = [];
    own.current = Date.now(); // an EPUB's next section is opened to be read: its move is read aloud's
    try {
      runs = await book.runs(unit, await skipOf(unit).catch(() => []));
    } catch { /* an unreadable page reads as an empty one */ }
    own.current = Date.now();
    if (mine !== session.current) return;
    const script = buildScript(runs);
    if (!script.paragraphs.length) {
      if (empty < MAX_EMPTY) play(unit + (place === 'last' ? -1 : 1), place === 'last' ? 'last' : null, empty + 1);
      else setState((s) => ({ ...s, playing: false }));
      return;
    }
    current.current = { unit, runs, script };
    const found = place && place !== 'last' && (book.runOf?.(runs, place.at, place.offset)
      ?? { run: runs.findIndex((r) => r.ref.item === place.at?.item), offset: place.offset });
    const at = place === 'last' ? { p: script.paragraphs.length - 1, s: 0, c: 0 }
      : found ? locate(script, found.run, found.offset) ?? { p: 0, s: 0, c: 0 } : { p: 0, s: 0, c: 0 };
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
    const el = state.open ? source()?.scroller?.() : null;
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

  /** The place changed: the reader's own scrolling, unless read aloud moved the view just now (C40.3). */
  const moved = useCallback(() => {
    if (Date.now() - own.current > OWN_MOVE_MS) manual.current = Date.now();
  }, []);

  return {
    supported: readAloudSupported(),
    moved,
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
