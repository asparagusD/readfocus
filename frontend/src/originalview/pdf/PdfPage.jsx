import { useEffect, useRef, useState } from 'react';
import { loadPdfjs } from './pdfjs';
import './pdf.css';

/**
 * One PDF page as published (C17.2): the cached canvas, rendered at the device pixel
 * ratio, with PDF.js's invisible text layer laid exactly over it for selection,
 * search and word lookup. `onShown(pageNumber)` fires once both are on screen.
 */
export function PdfPage({ cache, pageNumber, label, onShown }) {
  const root = useRef(null);
  const sheet = useRef(null);
  const text = useRef(null);
  const [size, setSize] = useState(null);
  const shown = useRef(onShown);
  useEffect(() => { shown.current = onShown; });

  useEffect(() => {
    if (!cache) return undefined;
    let layer = null;
    let gone = false;
    Promise.all([cache.get(pageNumber), loadPdfjs()]).then(([entry, pdfjs]) => {
      if (gone || !root.current || !sheet.current || !text.current) return null;
      const { canvas, viewport, textContent } = entry;
      setSize({ width: Math.floor(viewport.width), height: Math.floor(viewport.height) });
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

  return (
    <div ref={root} className="rf-pdf-page" role="group" aria-label={label ?? `Page ${pageNumber}`}
      style={size ? { width: size.width, height: size.height } : undefined}>
      <div ref={sheet} className="rf-pdf-page__canvas" />
      <div ref={text} className="textLayer" />
    </div>
  );
}
