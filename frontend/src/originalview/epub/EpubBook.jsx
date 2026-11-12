import { useCallback, useImperativeHandle, useRef, useState } from 'react';
import { epubThemeCss, locationAt } from '../frame';
import { EpubView } from './EpubView';

/** "p. 34 of ~210" or "pp. 34–35 of ~210"; "~" because the numbers count characters, not printed pages. */
function epubFolio(locations, place) {
  if (!locations) return null;
  const from = locationAt(locations, place.index, place.charStart);
  const to = locationAt(locations, place.index, Math.max(place.charStart, place.charEnd - 1));
  if (from === null) return null;
  return `${to > from ? `pp. ${from}–${to}` : `p. ${from}`} of ~${locations.total}`;
}

/**
 * An EPUB in the book frame (C17.4): EpubView with the frame's spread (`wide`), its own
 * page turns (foliate's slide off), the reader's type settings, lamplight colours, and
 * stable location numbers counted once per book. `ref` gets the renderer interface the
 * frame uses (Reader.jsx); onRelocate(place) fires on every move with
 * { folio, entry, atStart, atEnd, cfi }; onDocument(doc) for each section shown.
 */
export function EpubBook({ bookId, load, wide, settings, colours, onRelocate, onDocument, onError, ref }) {
  const view = useRef(null);
  const [locations, setLocations] = useState(null);
  const last = useRef(null);
  const send = useCallback((place, locs) => {
    if (!place) return;
    onRelocate?.({
      kind: 'epub', cfi: place.cfi, entry: place.tocItem?.label?.trim() || null,
      folio: epubFolio(locs, place) ?? 'Counting pages…',
      atStart: (place.fraction ?? 0) <= 0, atEnd: (place.fraction ?? 0) >= 0.9999,
    });
  }, [onRelocate]);

  const onReady = useCallback((engine) => {
    engine.locations(bookId).then((locs) => {
      setLocations(locs);
      send(last.current, locs);
    }).catch(() => {});
  }, [bookId, send]);
  const relocate = useCallback((place) => {
    last.current = place;
    send(place, locations);
  }, [send, locations]);

  useImperativeHandle(ref, () => ({
    kind: 'epub',
    next: () => view.current?.next().then(() => true),
    prev: () => view.current?.prev().then(() => true),
    first: () => view.current?.goToFraction(0).then(() => true),
    last: () => view.current?.goToFraction(1).then(() => true),
    goTo: (anchor) => view.current?.goTo(anchor?.cfi ?? anchor).then(() => true),
    visibleRange: () => ({ kind: 'epub', cfi: last.current?.cfi ?? null }),
    anchor: () => last.current && { kind: 'epub', cfi: last.current.cfi, text: '' },
    getSelection: () => {
      for (const { doc } of view.current?.contents() ?? []) {
        const selection = doc.getSelection();
        if (selection?.rangeCount && !selection.isCollapsed) return { text: selection.toString(), range: selection.getRangeAt(0), document: doc };
      }
      return null;
    },
    documents: () => (view.current?.contents() ?? []).map(({ doc }) => doc),
    panning: () => false,
    toc: view.current?.toc ?? [],
  }), []);

  return (
    <EpubView ref={view} bookId={bookId} load={load} animated={false} wide={wide}
      style={settings.style} fontSize={settings.fontSize} lineHeight={settings.lineHeight} margins={settings.margins}
      themeCss={colours ? epubThemeCss(colours) : ''}
      onReady={onReady} onRelocate={relocate} onLoad={({ doc }) => onDocument?.(doc)} onError={onError} label="Book pages" />
  );
}
