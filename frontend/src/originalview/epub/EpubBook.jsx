import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { epubThemeCss, locationAt } from '../frame';
import { EpubView } from './EpubView';
import { epubAnchor, epubPositions } from '../../anchors';
import { paintSection, readPalette } from '../../annotations/epubPaint';

/** "p. 34 of ~210" or "pp. 34–35 of ~210"; "~" because the numbers count characters, not printed pages. */
function epubFolio(locations, place) {
  if (!locations) return null;
  const from = locationAt(locations, place.index, place.charStart);
  const to = locationAt(locations, place.index, Math.max(place.charStart, place.charEnd - 1));
  if (from === null) return null;
  return `${to > from ? `pp. ${from}–${to}` : `p. ${from}`} of ~${locations.total}`;
}

const flatten = (items) => items.flatMap((item) => [item, ...flatten(item.subitems ?? [])]);

/** A promise for the engine, settled once EpubView has opened the book. */
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

/**
 * An EPUB in the book frame (C17.4): EpubView with the frame's spread (`wide`), its own
 * page turns (foliate's slide off), the reader's type settings, lamplight colours, and
 * stable location numbers counted once per book. `ref` gets the renderer interface the
 * frame uses (Reader.jsx); onRelocate(place) fires on every move with
 * { folio, entry, atStart, atEnd, cfi, index, charStart, charEnd }; onDocument(doc) for
 * each section shown. Since C17.5 it also finds text (find) and goes to a located
 * { index, char }; both wait for the engine, which can report a first place before it
 * is handed over.
 */
export function EpubBook({ bookId, load, wide, settings, colours, onRelocate, onDocument, onError, annotations = null, ref }) {
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
      atStart: (place.fraction ?? 0) <= 0, atEnd: (place.fraction ?? 0) >= 0.9999,
    });
  }, [onRelocate]);

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
  // again when one loads, the list changes or the colours do. A new text size keeps the document: the marks follow.
  useEffect(() => {
    const made = engine.current;
    if (!made || !annotations) return;
    const palette = readPalette(Boolean(colours));
    for (const { doc, index } of made.contents()) paintSection(doc, index, annotations, made.rangeFor, palette);
  }, [annotations, colours, loads]);

  useImperativeHandle(ref, () => {
    const now = () => engine.current;
    const later = (act) => opened.promise.then(act).then(() => true);
    return {
      kind: 'epub',
      next: () => later((e) => e.next()),
      prev: () => later((e) => e.prev()),
      first: () => later((e) => e.goToFraction(0)),
      last: () => later((e) => e.goToFraction(1)),
      // A located chunk start { index, char } (C17.5), a saved anchor { cfi }, a CFI or an href.
      goTo: (target) => later((e) => {
        if (target?.char !== undefined) return e.goToChar(target);
        if (target?.cfi && !target.cfi.includes(',')) return e.goToPoint(target.cfi); // a saved point
        return e.goTo(target?.cfi ?? target);
      }),
      find: (snippets) => opened.promise.then((e) => e.find(snippets)),
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
      getSelection: () => {
        for (const { doc } of now()?.contents() ?? []) {
          const selection = doc.getSelection();
          if (selection?.rangeCount && !selection.isCollapsed) return { text: selection.toString(), range: selection.getRangeAt(0), document: doc };
        }
        return null;
      },
      documents: () => (now()?.contents() ?? []).map(({ doc }) => doc),
      // C20.8c: a shown section's spine index, for the region map's EPUB places.
      sectionIndex: (doc) => (now()?.contents() ?? []).find((c) => c.doc === doc)?.index ?? null,
      panning: () => false,
      // The nav as one list, each entry with its section, for the contents drawer.
      toc: () => flatten(now()?.book.toc ?? []).map((item) => ({
        title: item.label?.trim() || 'Untitled', target: item.href, loc: { kind: 'epub', index: now().sectionOf(item.href) ?? 0, char: 0 },
      })),
    };
  }, [opened]);

  return (
    <EpubView bookId={bookId} load={load} animated={false} wide={wide}
      style={settings.style} fontSize={settings.fontSize} lineHeight={settings.lineHeight} margins={settings.margins}
      themeCss={colours ? epubThemeCss(colours) : ''}
      onReady={onReady} onRelocate={relocate} onLoad={({ doc }) => { onDocument?.(doc); setLoads((n) => n + 1); }} onError={onError} label="Book pages" />
  );
}
