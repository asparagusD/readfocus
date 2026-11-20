import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { entryForPage, pdfFolio, pdfScale } from '../frame';
import { squeeze } from '../place';
import { holdOf, layoutPages, pageBox, pagesInView, scrollForHold, scrollToPage, stepScroll } from '../scroll';
import { pdfAnchor, pdfPositions, quadsFromRects, rectsFromQuads } from '../../anchors';
import { forPages } from '../../annotations/paint';
import { pdfPagesLabel } from '../../annotations/list';
import { pdfNoteTop, shownAnchor } from '../../notes/markers';
import { pdfPageEnd } from '../../focus/bookmark';
import { useBoxSize } from '../useBoxSize';
import { storedOutline } from './contents';
import { PdfPage } from './PdfPage';
import { pdfOutline } from './pdfjs';
import { usePageCache, usePdfDocument } from './usePdfDocument';

/**
 * PDF anchors for a selection (ANCHORS A1, A2): one per page it touches, each with a quad
 * per line in points from the page's top-left (the page's own scale undone, so any zoom
 * gives the same quads) and that page's part of the text.
 */
function selectionAnchors(range, box, widths = []) {
  const out = [];
  for (const page of box.querySelectorAll('.rf-pdf-page[data-scale]')) {
    if (!range.intersectsNode(page)) continue;
    const part = range.cloneRange();
    const layer = page.querySelector('.textLayer');
    if (!layer) continue;
    if (!page.contains(range.startContainer)) part.setStart(layer, 0);
    if (!page.contains(range.endContainer)) part.setEnd(layer, layer.childNodes.length);
    const at = page.getBoundingClientRect();
    const quads = quadsFromRects(part.getClientRects(), at, Number(page.dataset.scale));
    if (!quads.length) continue;
    out.push(pdfAnchor(Number(page.dataset.page), quads, part.toString()));
    widths.push(at.width / Number(page.dataset.scale)); // the page's width in points, for A4 positions
  }
  return out;
}

const GAP = 16; // px between pages and around them, as Edge leaves
const NEAR = 2; // pages drawn either side of those in view (the page cache's radius)
const sameView = (a, b) => Boolean(a && b) && a.main === b.main && a.atStart === b.atStart && a.atEnd === b.atEnd
  && a.pages.join() === b.pages.join();

/**
 * A PDF read as Edge shows one (C38.2, issue 22): its pages one under another on the desk, scrolled, at `zoom`
 * ('fit-page', 'fit-width' or 1.25-2), as published in either theme (C38.3). Every page is laid out from its size (a
 * page not measured yet takes the opening page's, as PDF.js's own viewer does, so a long book opens without reading
 * every page), and only the pages in view and two either side are drawn. The place is the pages in view and the main
 * one, the most in view (scroll.js); a zoom, a resize or a page measured late keeps the words at the top of the view
 * where they were. `end` (the closing page's words) sits below the last page. `ref` gets the renderer interface the
 * frame uses (Reader.jsx); onRelocate(place) fires on every change with { pages, main, folio, entry, atStart, atEnd }.
 * C34.2: `startPage` is the page it opens at; `contents` (books.toc) stands in for the outline when it has pages.
 */
export function PdfBook({ bookId, load, zoom = 'fit-page', onRelocate, onError, ocr = null, annotations = null, contents = null, startPage = 1, end = null, ref }) {
  const { status, doc, numPages, error } = usePdfDocument(bookId, load);
  useEffect(() => { if (ocr && doc) ocr.attach(doc); }, [ocr, doc]); // C19.4: scanned pages read with the open PDF
  const box = useRef(null);
  const frame = useBoxSize(box);
  const [meta, setMeta] = useState({ labels: null, outline: [] });
  const [base, setBase] = useState(null); // the opening page's size in points: every page's until measured
  const [measured, setMeasured] = useState(() => new Map()); // page -> its own size in points, when not base's
  const [view, setView] = useState(null); // { pages, main, atStart, atEnd }
  const top = useRef(0); // the scroll last seen or set, for the hold through a layout change
  const laid = useRef(null); // the layout the scroll was last held against
  const relocate = useRef(onRelocate);
  useEffect(() => { relocate.current = onRelocate; });

  useEffect(() => {
    if (status === 'error') onError?.(error);
  }, [status, error, onError]);
  const opening = doc ? Math.min(Math.max(1, startPage), numPages) : 1;
  useEffect(() => {
    if (!doc) return;
    doc.getPage(opening).then((p) => {
      const { width, height } = p.getViewport({ scale: 1 });
      setBase({ width, height });
    }).catch(() => setBase({ width: 612, height: 792 }));
  }, [doc]); // eslint-disable-line react-hooks/exhaustive-deps -- the page it opened at, once
  // C34.2: the stored outline when it has pages; else the PDF's own, read once the opening page is
  // measured, so its page-tree reads never hold up the page the reader is waiting for.
  const stored = useMemo(() => storedOutline(contents), [contents]);
  const known = Boolean(base);
  useEffect(() => {
    if (!doc || (!stored && !known)) return;
    let gone = false;
    Promise.all([doc.getPageLabels().catch(() => null), stored ?? pdfOutline(doc).catch(() => [])])
      .then(([labels, outline]) => { if (!gone) setMeta({ labels, outline }); });
    return () => { gone = true; };
  }, [doc, stored, known]);

  const scale = base && frame ? pdfScale(zoom, base, { width: frame.width - GAP * 2, height: frame.height - GAP * 2 }) : null;
  const width = frame?.width ?? 0;
  const layout = useMemo(() => {
    if (!scale || !numPages) return null;
    const sizes = Array.from({ length: numPages }, (_, i) => {
      const size = measured.get(i + 1) ?? base;
      return { width: Math.floor(size.width * scale), height: Math.floor(size.height * scale) };
    });
    return layoutPages(sizes, { width, gap: GAP });
  }, [scale, numPages, measured, base, width]);

  const look = useCallback(() => {
    const el = box.current;
    if (!el || !laid.current) return;
    const seen = pagesInView(laid.current, el.scrollTop, el.clientHeight);
    seen.atEnd = seen.atEnd && el.scrollTop >= el.scrollHeight - el.clientHeight - 2; // the end below it read too
    setView((prev) => (sameView(prev, seen) ? prev : seen));
  }, []);
  // A new layout keeps the words at the view's top (a zoom, a resize, a page measured late); the first one opens
  // the book at its page.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !layout) return;
    const before = laid.current;
    laid.current = layout;
    el.scrollTop = before ? scrollForHold(layout, holdOf(before, top.current), el.clientHeight)
      : scrollToPage(layout, opening, el.clientHeight);
    top.current = el.scrollTop;
    look();
  }, [layout]); // eslint-disable-line react-hooks/exhaustive-deps -- once per layout
  const tick = useRef(0);
  const onScroll = () => {
    top.current = box.current.scrollTop;
    cancelAnimationFrame(tick.current);
    tick.current = requestAnimationFrame(look);
  };
  useEffect(() => () => cancelAnimationFrame(tick.current), []);
  /** Scrolls to `to`; true when the view moved. */
  const scrollTo = (to) => {
    const el = box.current;
    if (!el) return false;
    const before = el.scrollTop;
    el.scrollTop = to;
    top.current = el.scrollTop;
    look();
    return Math.abs(el.scrollTop - before) > 1;
  };

  const main = view?.main ?? opening;
  const shown = view?.pages ?? [];
  const first = Math.max(1, (shown[0] ?? main) - NEAR);
  const last = Math.min(numPages, (shown.at(-1) ?? main) + NEAR);
  const near = numPages ? Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i) : [];
  const nearKey = near.join();
  const cache = usePageCache(doc, scale, main);
  const drawn = annotations ? forPages(annotations, near) : null; // C21.3
  useEffect(() => { // a page drawn near the view is measured, and laid out at its own size when that differs
    if (!doc || !base) return undefined;
    let gone = false;
    for (const n of nearKey.split(',').map(Number)) {
      if (!n || measured.has(n)) continue;
      doc.getPage(n).then((p) => {
        const { width: w, height: h } = p.getViewport({ scale: 1 });
        if (gone || (Math.abs(w - base.width) < 0.5 && Math.abs(h - base.height) < 0.5)) return;
        setMeasured((prev) => (prev.has(n) ? prev : new Map(prev).set(n, { width: w, height: h })));
      }).catch(() => {});
    }
    return () => { gone = true; };
  }, [doc, base, nearKey]); // eslint-disable-line react-hooks/exhaustive-deps -- measured is read, not watched

  useEffect(() => {
    if (!doc || !view) return;
    relocate.current?.({
      kind: 'pdf', pages: view.pages.length ? view.pages : [view.main ?? opening], main: view.main ?? opening,
      folio: pdfFolio([view.main ?? opening], numPages, meta.labels),
      entry: entryForPage(meta.outline, view.main ?? opening)?.title ?? null, atStart: view.atStart, atEnd: view.atEnd,
    });
  }, [doc, view, numPages, meta]); // eslint-disable-line react-hooks/exhaustive-deps -- opening is the fallback only

  // Today's chunks are found by their text (C17.5): each page's text layer, squeezed, read once.
  const texts = useRef(new Map());
  useEffect(() => { texts.current = new Map(); }, [doc]);
  const pageText = (n) => {
    if (!texts.current.has(n)) {
      texts.current.set(n, doc.getPage(n).then((p) => p.getTextContent())
        .then((content) => squeeze(content.items.map((item) => item.str ?? '').join(''))).catch(() => ''));
    }
    return texts.current.get(n);
  };
  /** { kind: 'pdf', page } for the first page holding a snippet (longest first), from page `from` on, then before it. */
  const find = async (snippets, from = 1) => {
    const order = [...Array(numPages).keys()].map((i) => ((i + from - 1) % numPages) + 1);
    for (const snippet of snippets) {
      for (const n of order) if (snippet && (await pageText(n)).includes(snippet)) return { kind: 'pdf', page: n };
    }
    return null;
  };

  /** A page, or a passage on it: its first quad a little below the view's top. */
  const goTo = (anchor) => {
    const page = Math.min(numPages, Math.max(1, anchor?.page ?? anchor ?? 1));
    if (!laid.current) return false;
    const at = pageBox(laid.current, page);
    const [, y0] = anchor?.quads?.[0] ?? [];
    scrollTo(y0 > 0 && at ? at.top + y0 * scale - GAP * 3 : scrollToPage(laid.current, page, box.current?.clientHeight ?? 0));
    return true;
  };
  /** Arrow keys, Page Up and Down, Previous and Next: a page at a time; past the last page's top, the end below it. */
  const step = (dir) => {
    const el = box.current;
    if (!el || !laid.current) return false;
    const to = stepScroll(laid.current, el.scrollTop, el.clientHeight, dir);
    return scrollTo(dir > 0 && to <= el.scrollTop + 1 ? el.scrollHeight : to);
  };
  useImperativeHandle(ref, () => doc && {
    kind: 'pdf',
    next: () => step(1),
    prev: () => step(-1),
    first: () => scrollTo(0) || true,
    last: () => scrollTo(box.current?.scrollHeight ?? 0) || true,
    goTo,
    visibleRange: () => ({ kind: 'pdf', pages: shown.length ? [...shown] : [main] }),
    anchor: () => pdfAnchor(main, []), // a point at the main page's top-left (ANCHORS A3)
    selectionAnchors: () => {
      const selection = document.getSelection();
      if (!selection?.rangeCount || selection.isCollapsed || !box.current?.contains(selection.anchorNode)) return [];
      return selectionAnchors(selection.getRangeAt(0), box.current);
    },
    // C21.2: the selection's anchors with their A4 positions, plus the range and its document.
    selectionPlace: () => {
      const selection = document.getSelection();
      if (!selection?.rangeCount || selection.isCollapsed || !box.current?.contains(selection.anchorNode)) return null;
      const range = selection.getRangeAt(0);
      const widths = [];
      const anchors = selectionAnchors(range, box.current, widths);
      return anchors.length ? { anchors, ...pdfPositions(anchors, widths), range, doc: document } : null;
    },
    // C22.2b: where a new note goes: the selection, else the main page (one whole-page quad, no text).
    notePlace: async () => {
      const selection = document.getSelection();
      if (selection?.rangeCount && !selection.isCollapsed && box.current?.contains(selection.anchorNode)) {
        const widths = [];
        const anchors = selectionAnchors(selection.getRangeAt(0), box.current, widths);
        if (anchors.length) return { scope: 'selection', anchors, ...pdfPositions(anchors, widths) };
      }
      const [w, h] = await doc.getPage(main).then((p) => [p.view[2] - p.view[0], p.view[3] - p.view[1]]);
      const anchors = [{ kind: 'pdf', page: main, quads: [[0, 0, Math.round(w * 100) / 100, Math.round(h * 100) / 100]], text: '' }];
      return { scope: 'view', anchors, ...pdfPositions(anchors, [w]) };
    },
    // C23.6b: where focus mode's ribbon can be set: each page in view, a point at its end, with its printed label.
    shownPlaces: async () => {
      const pages = shown.length ? shown : [main];
      const sizes = await Promise.all(pages.map((n) => doc.getPage(n).then((p) => [n, p.view[3] - p.view[1]])));
      return sizes.map(([n, h]) => ({ anchor: pdfPageEnd(n, h), label: `p. ${meta.labels?.[n - 1] ?? n}` }));
    },
    // C22.4: where each note's passage is on the pages drawn, for its margin marker: beside the page's right edge.
    noteSpots: (notes, within) => notes.flatMap((note) => {
      const anchor = shownAnchor(note, near);
      const el = anchor && box.current?.querySelector(`.rf-pdf-page[data-page="${anchor.page}"][data-scale]`);
      if (!el) return [];
      const at = el.getBoundingClientRect();
      const pageScale = Number(el.dataset.scale);
      const y = pdfNoteTop(anchor, at.top, pageScale);
      if (y < within.top || y > within.bottom) return [];
      const [, y0 = 0, , y1 = 0] = anchor.quads?.[0] ?? [];
      return [{ id: note.id, top: y, height: (y1 - y0) * pageScale, side: 'right', edge: at.right }];
    }),
    // C22.5: a note's passage on the pages drawn, as screen rects (one per quad), to pulse it.
    passageRects: (note) => (note.anchors ?? []).flatMap((anchor) => {
      const el = anchor.kind === 'pdf' && near.includes(anchor.page) && box.current?.querySelector(`.rf-pdf-page[data-page="${anchor.page}"][data-scale]`);
      if (!el) return [];
      const at = el.getBoundingClientRect();
      return rectsFromQuads(anchor.quads ?? [], { left: at.left, top: at.top }, Number(el.dataset.scale));
    }),
    getSelection: () => {
      const selection = document.getSelection();
      if (!selection?.rangeCount || !box.current?.contains(selection.anchorNode)) return null;
      return { text: selection.toString(), range: selection.getRangeAt(0), document };
    },
    documents: () => [document],
    pageLabel: (annotation) => pdfPagesLabel(annotation, meta.labels), // C21.5: "p. 12" by the printed labels
    // C21.4: where each drawn annotation is, in this page's coordinates, for hover, taps and the chip.
    annotationEntries: () => {
      const byId = new Map();
      for (const el of box.current?.querySelectorAll('.rf-anno[data-id]') ?? []) {
        byId.set(el.dataset.id, [...(byId.get(el.dataset.id) ?? []), el.getBoundingClientRect()]);
      }
      return [...byId].map(([id, rects]) => ({ id, rects }));
    },
    panning: () => true, // C38.2: a swipe scrolls the pages; it never turns one
    find,
    toc: () => meta.outline.map((entry) => ({ title: entry.title, target: { page: entry.page }, loc: { kind: 'pdf', page: entry.page } })),
  });

  const across = layout ? Math.max(...layout.rows.map((r) => r.pages.at(-1).left + r.pages.at(-1).width)) + GAP : 0;
  return (
    <div ref={box} className="rf-pdf-book" data-zoom={typeof zoom === 'number' ? 'percent' : zoom} onScroll={onScroll}>
      <div className="rf-pdf-pages" style={layout ? { height: layout.height, width: across } : undefined}>
        {cache && layout && near.map((n) => {
          const at = pageBox(layout, n);
          return at && (
            <div key={n} className="rf-pdf-slot" style={{ left: at.left, top: at.top, width: at.width, height: at.height }}>
              <PdfPage cache={cache} pageNumber={n} label={`Page ${meta.labels?.[n - 1] ?? n}`} ocr={ocr} annotations={drawn} />
            </div>
          );
        })}
      </div>
      {end && layout && <div className="rf-pdf-end" data-no-lookup>{end}</div>}
    </div>
  );
}
