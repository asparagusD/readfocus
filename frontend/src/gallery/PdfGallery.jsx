import { useCallback, useState } from 'react';
import { PdfPage } from '../originalview/pdf/PdfPage';
import { usePageCache, usePdfDocument } from '../originalview/pdf/usePdfDocument';
import './gallery.css';

const ZOOMS = [1, 1.5, 2];
const CSS_PX_PER_POINT = 96 / 72; // 100 % = the page at its printed size
const params = new URLSearchParams(globalThis.location?.search ?? '');
// Benchmark timings, read by the scratchpad script; start = when this lazy page loaded.
const timings = (globalThis.__pdfTimings ??= { start: performance.now(), first: null, turns: [] });

/**
 * Dev-only /__pdf (C17.2): the PDF renderer on a chosen file, or on ?url=<signed URL>,
 * with page turns and zoom. Timings go to window.__pdfTimings for the benchmark:
 * ms from opening to the first page shown, and from each turn to its page shown.
 */
export default function PdfGallery() {
  const [file, setFile] = useState(null);
  const [current, setCurrent] = useState(Number(params.get('page')) || 1);
  const [zoom, setZoom] = useState(1);
  const [last, setLast] = useState(null);
  const url = params.get('url');
  const load = useCallback(async () => (file ? { data: new Uint8Array(await file.arrayBuffer()) } : { url }), [file, url]);
  const { status, doc, numPages, error } = usePdfDocument(file?.name ?? url ?? 'none', load);
  const cache = usePageCache(doc, zoom * CSS_PX_PER_POINT, current);

  const turn = (to) => {
    timings.turnStart = performance.now();
    setCurrent(Math.min(Math.max(1, to), numPages || 1));
  };
  const onShown = useCallback((page) => {
    const now = performance.now();
    if (timings.first === null) timings.first = now - timings.start;
    else if (timings.turnStart) timings.turns.push({ page, ms: now - timings.turnStart });
    timings.turnStart = null;
    setLast(page);
  }, []);

  return (
    <main className="gallery">
      <header className="gallery-header">
        <h1>PDF renderer</h1>
        <input type="file" accept=".pdf" aria-label="Open a PDF" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </header>
      <p>
        {status === 'ready' ? `Page ${current} of ${numPages}` : status}
        {error ? `: ${error.message}` : ''}
        {last ? ` · shown: ${last}` : ''}
      </p>
      <p>
        <button type="button" onClick={() => turn(current - 1)}>Previous</button>{' '}
        <button type="button" onClick={() => turn(current + 1)}>Next</button>{' '}
        {ZOOMS.map((z) => (
          <button key={z} type="button" aria-pressed={zoom === z} onClick={() => setZoom(z)}>{z * 100}%</button>
        ))}
      </p>
      {cache && <PdfPage key={`${zoom}`} cache={cache} pageNumber={current} onShown={onShown} />}
    </main>
  );
}
