import { useEffect, useRef, useState } from 'react';
import { spansFor } from './ocr';
import { loadPdfjs } from './pdfjs';
import { pdfBoxes } from '../../annotations/paint';
import './pdf.css';

/**
 * One PDF page as published (C17.2): the cached canvas, rendered at the device pixel
 * ratio, with PDF.js's invisible text layer laid exactly over it for selection,
 * search and word lookup. `onShown(pageNumber)` fires once both are on screen.
 * C19.4: on a scanned page `ocr` (pdf/ocr.js) gives the words read by OCR, added to the same
 * text layer; while the page is first read a quiet note says so.
 * C21.3: `annotations` (this page and its neighbours') are drawn as boxes between the canvas and the text layer,
 * blended so ink keeps its colour: `darken` on a light page, `lighten` on a recoloured dark one (`dark`).
 */
export function PdfPage({ cache, pageNumber, label, onShown, side = 'single', ocr = null, annotations = null, dark = false }) {
  const [reading, setReading] = useState(false);
  const root = useRef(null);
  const sheet = useRef(null);
  const text = useRef(null);
  const [size, setSize] = useState(null); // { width, height, scale }: CSS px, and CSS px per PDF point (C17.6 anchors)
  const shown = useRef(onShown);
  useEffect(() => { shown.current = onShown; });

  useEffect(() => {
    if (!cache) return undefined;
    let layer = null;
    let gone = false;
    Promise.all([cache.get(pageNumber), loadPdfjs()]).then(([entry, pdfjs]) => {
      if (gone || !root.current || !sheet.current || !text.current) return null;
      const { canvas, viewport, textContent } = entry;
      setSize({ width: Math.floor(viewport.width), height: Math.floor(viewport.height), scale: viewport.scale });
      root.current.style.setProperty('--total-scale-factor', viewport.scale);
      sheet.current.replaceChildren(canvas);
      text.current.replaceChildren();
      layer = new pdfjs.TextLayer({ textContentSource: textContent, container: text.current, viewport });
      return layer.render().then(() => !gone && shown.current?.(pageNumber));
    }).catch((error) => {
      if (!gone && error?.name !== 'AbortException') console.warn(`PDF page ${pageNumber} failed`, error);
    });
    return () => {
      gone = true;
      layer?.cancel();
    };
  }, [cache, pageNumber]);

  useEffect(() => {
    if (!ocr || !size) return undefined;
    let gone = false;
    const added = [];
    ocr.ready().then(() => {
      if (gone || !ocr.isScanned(pageNumber)) return null;
      if (!ocr.has(pageNumber)) setReading(true);
      return ocr.wordsFor(pageNumber).then((words) => {
        if (gone || !text.current) return;
        for (const span of spansFor(words, size.scale)) {
          const el = document.createElement('span');
          el.className = 'rf-ocr-word';
          el.textContent = span.text;
          Object.assign(el.style, { left: `${span.left}px`, top: `${span.top}px`, fontSize: `${span.height * 0.86}px`, transform: 'none' });
          text.current.append(el);
          const drawn = el.getBoundingClientRect().width;
          if (drawn > 0) el.style.transform = `scaleX(${span.width / drawn})`;
          added.push(el);
        }
      });
    }).catch(() => {}).finally(() => { if (!gone) setReading(false); });
    return () => {
      gone = true;
      added.forEach((el) => el.remove());
    };
  }, [ocr, pageNumber, size]);

  return (
    <div ref={root} className="rf-pdf-page" data-side={side} data-page={pageNumber} data-scale={size?.scale} role="group"
      aria-label={label ?? `Page ${pageNumber}`}
      style={size ? { width: size.width, height: size.height } : undefined}>
      <div ref={sheet} className="rf-pdf-page__canvas" />
      {size && annotations?.length > 0 && (
        // A light page takes Paper's colours even in Lamplight (original colours): the layer says which.
        <div className="rf-pdf-annos" data-theme={dark ? undefined : 'paper'} data-dark={dark || undefined} aria-hidden="true">
          {pdfBoxes(annotations, pageNumber, size.scale).map((box) => (
            <span key={box.key} className="rf-anno" data-id={box.id} data-style={box.style} data-colour={box.color}
              style={{ left: box.left, top: box.top, width: box.width, height: box.height }} />
          ))}
        </div>
      )}
      <div ref={text} className="textLayer" />
      {reading && <p className="rf-pdf-ocr" role="status">Making this page selectable…</p>}
    </div>
  );
}
