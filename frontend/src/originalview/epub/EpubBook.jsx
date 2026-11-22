import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { locationAt, locationPlace } from '../frame';
import { findPattern, matchesIn, searchOrder } from '../find';
import { epubMain } from '../scroll';
import { EpubView } from './EpubView';
import { epubAnchor, epubPositions } from '../../anchors';
import { epubEndPoint } from '../../focus/bookmark';
import { paintedIn, paintSection, readPalette } from '../../annotations/epubPaint';
import { epubRuns } from '../../reader/readAloud';

/** "p. 34 of ~210" or "pp. 34–35 of ~210"; "~" because the numbers count characters, not printed pages. */
function epubFolio(locations, place) {
  if (!locations) return null;
  const from = locationAt(locations, place.index, place.charStart);
  const to = locationAt(locations, place.index, Math.max(place.charStart, place.charEnd - 1));
  if (from === null) return null;
  return `${to > from ? `pp. ${from}–${to}` : `p. ${from}`} of ~${locations.total}`;
}

const flatten = (items) => items.flatMap((item) => [item, ...flatten(item.subitems ?? [])]);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const FOLLOWING = 4; // Node.DOCUMENT_POSITION_FOLLOWING

/** A promise for the engine, settled once EpubView has opened the book. */
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

/**
 * An EPUB in the book frame (C17.4): EpubView with the frame's spread (`wide`), its own
 * page turns (foliate's slide off), the reader's type settings (C38.3: never recoloured), and
 * stable location numbers counted once per book. `ref` gets the renderer interface the
 * frame uses (Reader.jsx); onRelocate(place) fires on every move with
 * { folio, entry, atStart, atEnd, cfi, index, charStart, charEnd }; onDocument(doc) for
 * each section shown. Since C17.5 it also finds text (find) and goes to a located
 * { index, char }; both wait for the engine, which can report a first place before it
 * is handed over.
 * C38.5c: find (Ctrl+F) through every section's text as packaged: `search(query, onUpdate)` in book order from the
 * section shown round the book, `showMatch` turns to the page holding a match, and `found` ({ matches, current })
 * is highlighted in each shown section's document (CSS Custom Highlights rf-find and rf-find-current, as a PDF's).
 * C38.7a (issue 22): scrolled (engine.js): one column, so no spread and every margin marker on the right; a swipe
 * scrolls; `scrollBy(px)` for Up and Down; the place's `main` is the location page most in view.
 * C38.7b: the place also carries `page` (that page), `total` and `approx` for the toolbar's page box, and
 * goTo({ location }) goes to the start of a counted page.
 * C40.3 (issue 24): `readAloud` (useReadAloud): its units are the sections (unit = spine index + 1); a section not
 * shown is opened to be read, its text nodes are the runs (readAloud.epubRuns), and it starts from the selection or
 * the first words in view.
 */
export function EpubBook({ bookId, load, wide, settings, onRelocate, onDocument, onError, annotations = null, found = null, ref }) {
  const [locations, setLocations] = useState(null);
  const [opened] = useState(deferred);
  const engine = useRef(null);
  const last = useRef(null);
  const send = useCallback((place, locs) => {
    if (!place) return;
    onRelocate?.({
      kind: 'epub', cfi: place.cfi, entry: place.tocItem?.label?.trim() || null,
      index: place.index, charStart: place.charStart, charEnd: place.charEnd,
      folio: epubFolio(locs, place) ?? 'Counting pages…',
      // C38.7a: scrolled, the book's first section's top and last section's bottom (engine.js); paged, the fraction
      atStart: place.atStart ?? (place.fraction ?? 0) <= 0, atEnd: place.atEnd ?? (place.fraction ?? 0) >= 0.9999,
      main: epubMain(locs, place.index, place.charStart, place.charEnd), // the location page most in view (focus F7)
      // C38.7b: the toolbar's page box: that page of the counted ones (approximate: they count characters)
      ...(locs ? { page: epubMain(locs, place.index, place.charStart, place.charEnd), total: locs.total, approx: true } : {}),
    });
  }, [onRelocate]);

  const counted = useRef(null); // the locations, for page labels asked through the ref (C21.5)
  useEffect(() => { counted.current = locations; }, [locations]);
  const [loads, setLoads] = useState(0); // the engine opening, then each section loaded: a reason to paint again
  const onReady = useCallback((made) => {
    engine.current = made;
    setLoads((n) => n + 1);
    opened.resolve(made);
    made.locations(bookId).then((locs) => {
      setLocations(locs);
      send(last.current, locs);
    }).catch(() => {});
  }, [bookId, send, opened]);
  const relocate = useCallback((place) => {
    last.current = place;
    send(place, locations);
  }, [send, locations]);

  // C21.3: highlights and underlines in each shown section's document (CSS Custom Highlights; epubPaint.js),
  // again when one loads or the list changes. A new text size keeps the document: the marks follow. C38.3: the page is
  // as published, light, so Paper's highlight colours in either theme.
  useEffect(() => {
    const made = engine.current;
    if (!made || !annotations) return;
    const palette = readPalette(false);
    for (const { doc, index } of made.contents()) paintSection(doc, index, annotations, made.rangeFor, palette);
  }, [annotations, loads]);

  // C38.5c: find's matches in each shown section's own registry, in the page's find colours.
  useEffect(() => {
    const made = engine.current;
    if (!made || !found?.matches.length) return undefined;
    const marked = [];
    const page = getComputedStyle(document.documentElement);
    for (const { doc, index } of made.contents()) {
      const win = doc?.defaultView;
      if (!win?.CSS?.highlights || typeof win.Highlight !== 'function') continue;
      const here = found.matches.filter((m) => m.index === index);
      const ranges = made.rangesOf(doc.body, here.map((m) => [m.start, m.end])); // engine.js loads lazily
      const all = [];
      const current = [];
      here.forEach((m, i) => ranges[i] && (m === found.current ? current : all).push(ranges[i]));
      let style = doc.head?.querySelector('style[data-rf-find]');
      if (!style) {
        style = doc.createElement('style');
        style.setAttribute('data-rf-find', '');
        doc.head?.append(style);
      }
      style.textContent = `::highlight(rf-find) { background-color: ${page.getPropertyValue('--find-match').trim()}; }
::highlight(rf-find-current) { background-color: ${page.getPropertyValue('--find-current').trim()}; }`;
      win.CSS.highlights.set('rf-find', new win.Highlight(...all));
      win.CSS.highlights.set('rf-find-current', new win.Highlight(...current));
      marked.push(win);
    }
    return () => marked.forEach((win) => {
      try {
        win.CSS.highlights.delete('rf-find');
        win.CSS.highlights.delete('rf-find-current');
      } catch { /* the section's document is gone */ }
    });
  }, [found, loads]);
  const searching = useRef(null);
  useEffect(() => () => { searching.current = null; }, []);

  useImperativeHandle(ref, () => {
    const now = () => engine.current;
    const later = (act) => opened.promise.then(act).then(() => true);
    return {
      kind: 'epub',
      next: () => later((e) => e.next()),
      prev: () => later((e) => e.prev()),
      scrollBy: (px) => later((e) => e.scrollBy(px)), // C38.7a
      first: () => later((e) => e.goToFraction(0)),
      last: () => later((e) => e.goToEnd()), // C38.7a: the last section's foot
      // A located chunk start { index, char } (C17.5), a saved anchor { cfi }, a CFI or an href.
      goTo: (target) => later((e) => {
        if (target?.location !== undefined) { // C38.7b: a typed page of the page box
          const at = locationPlace(counted.current, target.location);
          return at ? e.goToChar(at) : null;
        }
        if (target?.char !== undefined) return e.goToChar(target);
        if (target?.cfi && !target.cfi.includes(',')) return e.goToPoint(target.cfi); // a saved point
        return e.goTo(target?.cfi ?? target);
      }),
      find: (snippets) => opened.promise.then((e) => e.find(snippets)),
      // C38.5c: every match of `query`, section by section from the one shown round the book; onUpdate as PdfBook's.
      search: async (query, onUpdate) => {
        const run = {};
        searching.current = run;
        const made = await opened.promise;
        const pattern = findPattern(query);
        const shown = last.current?.index ?? 0;
        const order = pattern ? searchOrder(made.sectionCount(), shown + 1).map((n) => n - 1) : [];
        const after = [];
        const before = [];
        let told = 0;
        for (const [i, index] of order.entries()) {
          const text = await made.sectionPlain(index);
          if (searching.current !== run) return;
          for (const [start, end] of matchesIn(text, pattern)) (index >= shown ? after : before).push({ index, start, end });
          const done = i === order.length - 1;
          if (done || performance.now() - told > 120) {
            told = performance.now();
            onUpdate({ matches: before.concat(after), first: after[0] ?? before[0] ?? null, done });
          }
        }
        if (!order.length) onUpdate({ matches: [], first: null, done: true });
      },
      stopSearch: () => { searching.current = null; },
      showMatch: (match) => { now()?.goToMatch(match); },
      visibleRange: () => ({ kind: 'epub', cfi: last.current?.cfi ?? null }),
      // The reading position, a point (A3) a little inside the text shown: a page's first character can
      // fall on the page before after any re-layout, so it would reopen a page early (DEBUG_LOG C17.6).
      anchor: () => {
        const place = last.current;
        if (!place) return null;
        const inside = place.charStart + Math.min(40, Math.floor((place.charEnd - place.charStart) / 4));
        return epubAnchor(now()?.pointAt(place.index, inside) ?? now()?.pointCfi(place.cfi) ?? place.cfi);
      },
      // The selection as an EPUB anchor (A1): a range CFI in its section, structural, so a new font size keeps it.
      selectionAnchors: () => {
        for (const { doc } of now()?.contents() ?? []) {
          const selection = doc.getSelection();
          if (!selection?.rangeCount || selection.isCollapsed) continue;
          const range = selection.getRangeAt(0);
          const cfi = now().cfiFor(doc, range);
          return cfi ? [epubAnchor(cfi, range.toString())] : [];
        }
        return [];
      },
      // C21.2: the selection as one range anchor with its A4 positions, plus the range and its document.
      selectionPlace: () => {
        for (const { doc, index } of now()?.contents() ?? []) {
          const selection = doc.getSelection();
          if (!selection?.rangeCount || selection.isCollapsed) continue;
          const range = selection.getRangeAt(0);
          const cfi = now().cfiFor(doc, range);
          if (!cfi) return null;
          const [start, end] = now().charsOf(doc, range);
          return { anchors: [epubAnchor(cfi, range.toString())], ...epubPositions(index, start, end), range, doc };
        }
        return null;
      },
      // C22.2b: where a new note goes: the selection, else the page shown (its range CFI, no text).
      notePlace: async () => {
        for (const { doc, index } of now()?.contents() ?? []) {
          const selection = doc.getSelection();
          if (!selection?.rangeCount || selection.isCollapsed) continue;
          const range = selection.getRangeAt(0);
          const cfi = now().cfiFor(doc, range);
          if (!cfi) break;
          const [start, end] = now().charsOf(doc, range);
          return { scope: 'selection', anchors: [epubAnchor(cfi, range.toString())], ...epubPositions(index, start, end) };
        }
        const place = last.current;
        if (!place?.cfi?.includes(',')) return null;
        return { scope: 'view', anchors: [epubAnchor(place.cfi)], ...epubPositions(place.index, place.charStart, place.charEnd) };
      },
      // C23.6b: where focus mode's ribbon can be set: the end of the page shown (the Reader adds its folio).
      shownPlaces: async () => {
        const anchor = epubEndPoint(last.current?.cfi);
        return anchor ? [{ anchor, label: null }] : [];
      },
      getSelection: () => {
        for (const { doc } of now()?.contents() ?? []) {
          const selection = doc.getSelection();
          if (selection?.rangeCount && !selection.isCollapsed) return { text: selection.toString(), range: selection.getRangeAt(0), document: doc };
        }
        return null;
      },
      documents: () => (now()?.contents() ?? []).map(({ doc }) => doc),
      // C21.5: "p. 34" for an annotation, from its A4 position (spine item and characters) and the counted pages.
      pageLabel: (annotation) => {
        const page = locationAt(counted.current, Math.floor(annotation.position_start / 1e6), annotation.position_start % 1e6);
        return page ? `p. ${page}` : '';
      },
      // C21.4: where each painted annotation is, in the page's coordinates (each section's frame shifts it).
      annotationEntries: () => {
        const byId = new Map();
        for (const { doc } of now()?.contents() ?? []) {
          const frame = doc.defaultView?.frameElement?.getBoundingClientRect();
          if (!frame) continue;
          for (const { id, range } of paintedIn(doc)) {
            const rects = [...range.getClientRects()].map((r) => new DOMRect(r.x + frame.x, r.y + frame.y, r.width, r.height));
            byId.set(id, [...(byId.get(id) ?? []), ...rects]);
          }
        }
        return [...byId].map(([id, rects]) => ({ id, rects }));
      },
      // C22.6: a whole element of a shown section (an equation, listing or figure) as a note's place: its range CFI
      // and characters, with `text` (a selection) or without (the view scope).
      elementPlace: (doc, el, text) => {
        const shown = (now()?.contents() ?? []).find((c) => c.doc === doc);
        if (!shown) return null;
        const range = doc.createRange();
        range.selectNode(el);
        const cfi = now().cfiFor(doc, range);
        if (!cfi) return null;
        // A4 from the element's own characters: a selectNode range starts in the parent, which charsOf counts from
        // the parent's first character (DEBUG_LOG C22.G); a range starting inside the element counts those before it.
        const inside = doc.createRange();
        inside.setStart(el, 0);
        const [start] = now().charsOf(doc, inside);
        const end = start + (el.textContent?.length ?? 0);
        const words = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 2000);
        return { scope: words ? 'selection' : 'view', anchors: [epubAnchor(cfi, words)], ...epubPositions(shown.index, start, end) };
      },
      // C22.4: where each note's passage is on the page shown, for its margin marker: its first line inside
      // `within` (the book's box), and the page of the spread it is on.
      noteSpots: (notes, within) => {
        const out = [];
        for (const { doc } of now()?.contents() ?? []) {
          const frame = doc.defaultView?.frameElement?.getBoundingClientRect();
          if (!frame) continue;
          for (const note of notes) {
            const anchor = note.anchors?.find((a) => a.kind === 'epub');
            const range = anchor && now().rangeFor(doc, anchor.cfi);
            if (!range) continue;
            const line = [...range.getClientRects()].map((r) => ({ x: r.x + frame.x, y: r.y + frame.y, height: r.height, width: r.width }))
              .find((r) => r.height > 0 && r.x + r.width > within.left && r.x < within.right && r.y + r.height > within.top && r.y < within.bottom);
            if (!line) continue;
            const side = wide && !now().scrolled && line.x + line.width / 2 < within.left + within.width / 2 ? 'left' : 'right';
            // C38.8b: scrolled, the column is on the desk: the marker beside its edge (the section's frame), as a PDF's
            const edge = now().scrolled ? (side === 'left' ? frame.left : frame.right) : undefined;
            out.push({ id: note.id, top: line.y, height: line.height, side, edge });
          }
        }
        return out;
      },
      // C22.5: a note's passage in the sections shown, as screen rects (each line), to pulse it.
      passageRects: (note) => {
        const out = [];
        for (const { doc } of now()?.contents() ?? []) {
          const frame = doc.defaultView?.frameElement?.getBoundingClientRect();
          if (!frame) continue;
          for (const anchor of note.anchors ?? []) {
            const range = anchor.kind === 'epub' && now().rangeFor(doc, anchor.cfi);
            if (!range) continue;
            for (const r of range.getClientRects()) {
              if (r.width > 0 && r.height > 0) out.push({ left: r.x + frame.x, top: r.y + frame.y, width: r.width, height: r.height });
            }
          }
        }
        return out;
      },
      // C20.8c: a shown section's spine index, for the region map's EPUB places.
      sectionIndex: (doc) => (now()?.contents() ?? []).find((c) => c.doc === doc)?.index ?? null,
      panning: () => Boolean(now()?.scrolled), // C38.7a: a swipe scrolls a scrolled book; a fixed layout's turns
      // The nav as one list, each entry with its section, for the contents drawer.
      // C40.6: the words in view for Steve's Summarize this page, with the place's range as its anchor
      pageWords: async () => {
        const place = last.current;
        const made = now();
        const doc = place && made?.contents().find((c) => c.index === place.index)?.doc;
        const range = doc && made.rangesOf(doc.body, [[place.charStart, place.charEnd]])[0];
        if (!range || !place.cfi) return null;
        return { anchor: { kind: 'epub', cfi: place.cfi, text: '' }, text: range.toString(), label: 'this page' };
      },
      readAloud: { // C40.3
        get count() { return now()?.sectionCount() ?? 0; },
        runs: async (unit) => {
          const made = await opened.promise;
          const shownDoc = () => made.contents() // loaded: not the blank document a frame starts with, its body filled
            .find((c) => c.index === unit - 1 && c.doc?.URL !== 'about:blank' && c.doc?.body?.childNodes.length)?.doc;
          if (!shownDoc()) {
            await made.goToChar({ index: unit - 1, char: 0 });
            for (let tries = 0; tries < 50 && !shownDoc(); tries += 1) await pause(100); // the section loads
          }
          const doc = shownDoc();
          return doc ? epubRuns(doc.body) : [];
        },
        range: (node, start, end) => {
          if (!node?.isConnected || !node.ownerDocument?.defaultView) return null; // its section has been unloaded
          const range = node.ownerDocument.createRange();
          range.setStart(node, Math.min(start, node.length));
          range.setEnd(node, Math.min(end, node.length));
          return range;
        },
        /** A start place among the runs: the run holding `at`, else the first one after it. */
        runOf: (runs, at, offset = 0) => {
          const run = runs.findIndex((r) => r.ref === at);
          if (run >= 0 || !at) return { run, offset };
          return { run: runs.findIndex((r) => at.compareDocumentPosition?.(r.ref) & FOLLOWING), offset: 0 };
        },
        from: () => {
          for (const { doc, index } of now()?.contents() ?? []) {
            const selection = doc.getSelection();
            if (!selection?.rangeCount || selection.isCollapsed) continue;
            const range = selection.getRangeAt(0);
            return { unit: index + 1, at: range.startContainer, offset: range.startOffset };
          }
          const place = last.current;
          const doc = place && now()?.contents().find((c) => c.index === place.index)?.doc;
          const range = doc && now().rangesOf(doc.body, [[place.charStart, place.charStart + 1]])[0];
          return { unit: (place?.index ?? 0) + 1, at: range?.startContainer ?? null, offset: range?.startOffset ?? 0 };
        },
        show: (unit) => { now()?.goToChar({ index: unit - 1, char: 0 }); },
        /** A spoken word (`rect` in its section's frame) a third of the way down the view, when near an edge or out. */
        follow: (rect, range) => {
          const frame = range?.startContainer.ownerDocument?.defaultView?.frameElement?.getBoundingClientRect();
          const view = now()?.viewRect?.();
          if (!frame || !view || !rect) return;
          const top = rect.top + frame.top;
          if (top < view.top + 72 || rect.bottom + frame.top > view.bottom - 96) now().scrollBy(Math.round(top - view.top - view.height / 3));
        },
      },
      toc: () => flatten(now()?.book.toc ?? []).map((item) => ({
        title: item.label?.trim() || 'Untitled', target: item.href, loc: { kind: 'epub', index: now().sectionOf(item.href) ?? 0, char: 0 },
      })),
    };
  }, [opened, wide]);

  return (
    <EpubView bookId={bookId} load={load} animated={false} wide={wide}
      style={settings.style} fontSize={settings.fontSize} lineHeight={settings.lineHeight} margins={settings.margins}
      onReady={onReady} onRelocate={relocate} onLoad={({ doc }) => { onDocument?.(doc); setLoads((n) => n + 1); }} onError={onError} label="Book pages" />
  );
}
