import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { entryForPage, pdfFolio, pdfScale, spreadPages, stepSpread } from '../frame';
import { squeeze } from '../today';
import { pdfAnchor, pdfPositions, quadsFromRects } from '../../anchors';
import { forPages } from '../../annotations/paint';

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
import { useBoxSize } from '../useBoxSize';
import { PdfPage } from './PdfPage';
import { pdfOutline } from './pdfjs';
import { usePageCache, usePdfDocument } from './usePdfDocument';

const SHEET_INSET = 16; // px kept clear around the pages inside the frame

/**
 * A PDF in the book frame (C17.4): one page, or a spread when `wide`, at `zoom`
 * ('fit-page', 'fit-width' or 1.25-2), recoloured with `colours` in lamplight.
 * Larger than the frame, it scrolls and a mouse drag pans it. `ref` gets the
 * renderer interface the frame uses (Reader.jsx); onRelocate(place) fires on
 * every move with { pages, folio, entry, atStart, atEnd }.
 */
export function PdfBook({ bookId, load, wide, zoom = 'fit-page', colours = null, onRelocate, onError, onSheet, ocr = null, annotations = null, ref }) {
  const { status, doc, numPages, error } = usePdfDocument(bookId, load);
  useEffect(() => { if (ocr && doc) ocr.attach(doc); }, [ocr, doc]); // C19.4: scanned pages read with the open PDF
  const box = useRef(null);
  const frame = useBoxSize(box);
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ labels: null, outline: [] });
  const [size, setSize] = useState(null); // the current page's size in points
  const pan = useRef(null);
  const relocate = useRef(onRelocate);
  useEffect(() => { relocate.current = onRelocate; });

  useEffect(() => {
    if (status === 'error') onError?.(error);
  }, [status, error, onError]);
  useEffect(() => {
    if (!doc) return;
    Promise.all([doc.getPageLabels().catch(() => null), pdfOutline(doc).catch(() => [])])
      .then(([labels, outline]) => setMeta({ labels, outline }));
  }, [doc]);
  const pages = doc ? spreadPages(Math.min(page, numPages), numPages, wide) : [];
  useEffect(() => {
    if (!doc) return;
    doc.getPage(pages[0]).then((p) => {
      const { width, height } = p.getViewport({ scale: 1 });
      setSize((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
    });
  }, [doc, pages[0]]); // eslint-disable-line react-hooks/exhaustive-deps -- the first page shown

  const scale = size && frame
    ? pdfScale(zoom, size, { width: frame.width - SHEET_INSET * 2, height: frame.height - SHEET_INSET * 2 }, pages.length)
    : null;
  const cache = usePageCache(doc, scale, pages[0], colours);
  const drawn = annotations ? forPages(annotations, pages) : null; // C21.3: the pages shown and one either side
  // The frame hugs the paper (C17.4 review): the spread's width at fit-page or fit-width.
  const sheetWidth = scale && size ? Math.round(size.width * scale * pages.length + SHEET_INSET * 2) : null;
  const sheetHeight = scale && size ? Math.round(size.height * scale + SHEET_INSET * 2) : null;
  useEffect(() => {
    onSheet?.(typeof zoom === 'number' || !sheetWidth ? null : { width: sheetWidth, height: sheetHeight });
  }, [sheetWidth, sheetHeight, zoom, onSheet]);

  useEffect(() => {
    if (!doc) return;
    relocate.current?.({
      kind: 'pdf', pages, folio: pdfFolio(pages, numPages, meta.labels),
      entry: entryForPage(meta.outline, pages[0])?.title ?? null,
      atStart: pages[0] === 1, atEnd: pages.at(-1) >= numPages,
    });
  }, [doc, pages.join(), numPages, meta]); // eslint-disable-line react-hooks/exhaustive-deps -- pages by value

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

  const turn = (dir) => {
    const to = stepSpread(pages[0], numPages, wide, dir);
    if (to === pages[0]) return false;
    setPage(to);
    box.current?.scrollTo(0, 0);
    return true;
  };
  useImperativeHandle(ref, () => doc && {
    kind: 'pdf',
    next: () => turn(1),
    prev: () => turn(-1),
    first: () => { setPage(1); return true; },
    last: () => { setPage(numPages); return true; },
    goTo: (anchor) => { setPage(Math.min(numPages, Math.max(1, anchor?.page ?? anchor ?? 1))); return true; },
    visibleRange: () => ({ kind: 'pdf', pages: [...pages] }),
    anchor: () => pdfAnchor(pages[0], []), // a point at the page's top-left (ANCHORS A3)
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
    getSelection: () => {
      const selection = document.getSelection();
      if (!selection?.rangeCount || !box.current?.contains(selection.anchorNode)) return null;
      return { text: selection.toString(), range: selection.getRangeAt(0), document };
    },
    documents: () => [document],
    // C21.4: where each drawn annotation is, in this page's coordinates, for hover, taps and the chip.
    annotationEntries: () => {
      const byId = new Map();
      for (const el of box.current?.querySelectorAll('.rf-anno[data-id]') ?? []) {
        byId.set(el.dataset.id, [...(byId.get(el.dataset.id) ?? []), el.getBoundingClientRect()]);
      }
      return [...byId].map(([id, rects]) => ({ id, rects }));
    },
    panning: () => Boolean(box.current && (box.current.scrollWidth > box.current.clientWidth + 1 || box.current.scrollHeight > box.current.clientHeight + 1)),
    find,
    toc: () => meta.outline.map((entry) => ({ title: entry.title, target: { page: entry.page }, loc: { kind: 'pdf', page: entry.page } })),
  });

  // A mouse drag pans a page larger than the frame; touch scrolls natively.
  const onPointerDown = (event) => {
    const el = box.current;
    if (event.pointerType !== 'mouse' || event.button !== 0 || !el || el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight) return;
    if (event.target.closest?.('.textLayer span')) return; // text stays selectable
    pan.current = { x: event.clientX, y: event.clientY, left: el.scrollLeft, top: el.scrollTop };
    el.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event) => {
    const start = pan.current;
    if (!start) return;
    box.current.scrollLeft = start.left - (event.clientX - start.x);
    box.current.scrollTop = start.top - (event.clientY - start.y);
  };

  return (
    <div ref={box} className="rf-pdf-book" data-zoom={typeof zoom === 'number' ? 'percent' : zoom}
      style={colours ? { '--rf-pdf-paper': colours.background } : undefined}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => { pan.current = null; }}
      onPointerCancel={() => { pan.current = null; }}>
      <div className="rf-pdf-spread" data-pages={pages.length}>
        {cache && pages.map((n, i) => (
          <PdfPage key={n} cache={cache} pageNumber={n} side={pages.length > 1 ? (i ? 'right' : 'left') : 'single'}
            label={`Page ${meta.labels?.[n - 1] ?? n}`} ocr={ocr} annotations={drawn} dark={Boolean(colours)} />
        ))}
      </div>
    </div>
  );
}
