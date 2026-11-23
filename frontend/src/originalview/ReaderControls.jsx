import { useState } from 'react';
import { Maximize, MoveHorizontal, MoveVertical, Search, Type, UnfoldHorizontal, ZoomIn, ZoomOut } from 'lucide-react';
import { FONT_SIZES, MAX_ZOOM, MIN_ZOOM, fontStep, parseZoom, zoomLabel, zoomStep } from './frame';

const LINE_HEIGHTS = [null, 1.45, 1.65, 1.85]; // null: the publisher's own
const MARGINS = ['narrow', 'normal', 'wide'];
const next = (list, value) => list[(list.indexOf(value) + 1) % list.length];

/** C38.4a: Edge's Page view for a PDF. */
const PAGE_VIEWS = [['one', 'One page'], ['two', 'Two pages'], ['cover', 'Cover alone']];

/**
 * Edge's page box (C38.4a): the main page's number, which a reader can type over; Enter goes there (a number
 * outside the book or not a number goes back to the page shown), Escape or leaving the box puts the page back.
 */
function PageBox({ page, total, onGo, approx = false, inputRef = null }) {
  const [draft, setDraft] = useState(null); // null: show the page
  const go = () => {
    const n = Number.parseInt(draft ?? '', 10);
    setDraft(null);
    if (n >= 1 && n <= total && n !== page) onGo(n);
  };
  return (
    <div className="rf-page-box">
      <input ref={inputRef} type="text" inputMode="numeric" className="rf-page-input" aria-label={`Page number, of ${approx ? 'about ' : ''}${total}`}
        size={Math.max(2, String(total).length)} value={draft ?? String(page)}
        onFocus={(event) => { setDraft(String(page)); event.target.select(); }}
        onChange={(event) => setDraft(event.target.value.replace(/\D/g, '').slice(0, 6))}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); go(); }
          if (event.key === 'Escape') { event.preventDefault(); setDraft(null); event.currentTarget.blur(); }
        }}
        onBlur={() => setDraft(null)} />
      <span className="rf-page-total" aria-hidden="true">of {approx ? '~' : ''}{total}</span>
    </div>
  );
}

/**
 * C41.1 (issue 28): Edge's zoom box, the zoom in percent (a fit's too), which a reader can type over; Enter zooms to
 * it (kept to 25-500 %; not a number puts the zoom back), Escape or leaving the box puts it back.
 */
function ZoomBox({ zoom, percent, onZoom }) {
  const [draft, setDraft] = useState(null); // null: show the zoom
  const label = zoomLabel(zoom, percent);
  const go = () => {
    const next = parseZoom(draft);
    setDraft(null);
    if (next !== null && next !== zoom) onZoom(next);
  };
  return (
    <input type="text" inputMode="decimal" className="rf-page-input rf-zoom-input" size={5}
      aria-label={`Zoom, ${label}. Type a percentage`} value={draft ?? label}
      onFocus={(event) => { setDraft(label); event.target.select(); }}
      onChange={(event) => setDraft(event.target.value.replace(/[^\d.%]/g, '').slice(0, 6))}
      onKeyDown={(event) => {
        if (event.key === 'Enter') { event.preventDefault(); go(); }
        if (event.key === 'Escape') { event.preventDefault(); setDraft(null); event.currentTarget.blur(); }
      }}
      onBlur={() => setDraft(null)} />
  );
}

/**
 * The original view's controls for the reader toolbar (C17.4): zoom out, zoom level and zoom in for a PDF (C41.1:
 * Edge's: the level in percent from `place.percent` for a fit, typed over in ZoomBox, − and + through Edge's steps,
 * and Fit to page or Fit to width beside them);
 * smaller and larger text, line spacing and margins for an EPUB. C38.3: the "Original
 * colours" switch is gone: a book is never recoloured. C38.4a (issue 22): a PDF also has Edge's page box (`place`,
 * `onGoToPage`) and Page view (`pageView`, `onPageView`). C38.7b: an EPUB has the page box too, its counted pages ("of
 * ~210": they count characters). C38.9: `pageInput` is the page box's input, for Ctrl+Alt+G. C38.5: Find (`onFind`, also Ctrl+F); C38.5c: for an EPUB too.
 */
export function ReaderControls({ kind, zoom, onZoom, settings, onSettings, place = null, onGoToPage = null, pageView = 'one', onPageView = null, onFind = null, pageInput = null }) {
  const set = (patch) => onSettings({ ...settings, ...patch });
  const size = settings?.fontSize ?? 18;
  const percent = place?.percent ?? null;
  const fit = zoom === 'fit-page' ? 'fit-width' : 'fit-page'; // what the fit button (and Ctrl+\) does next, as Edge's
  return (
    <>
      {kind === 'pdf' ? (
        <div className="rf-toolbar-group" role="group" aria-label="Zoom">
          <button type="button" className="rf-tool" onClick={() => onZoom(zoomStep(zoom, -1, percent))} disabled={zoomStep(zoom, -1, percent) === zoom}
            aria-label="Zoom out" aria-keyshortcuts="Control+-" title={`Zoom out (Ctrl+-), down to ${MIN_ZOOM * 100}%`}>
            <ZoomOut size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <ZoomBox zoom={zoom} percent={percent} onZoom={onZoom} />
          <button type="button" className="rf-tool" onClick={() => onZoom(zoomStep(zoom, 1, percent))} disabled={zoomStep(zoom, 1, percent) === zoom}
            aria-label="Zoom in" aria-keyshortcuts="Control+=" title={`Zoom in (Ctrl+=), up to ${MAX_ZOOM * 100}%`}>
            <ZoomIn size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button type="button" className="rf-tool" onClick={() => onZoom(fit)} aria-label={fit === 'fit-width' ? 'Fit to width' : 'Fit to page'}
            aria-keyshortcuts={'Control+\\'} title={`${fit === 'fit-width' ? 'Fit to width' : 'Fit to page'} (Ctrl+\\)`}>
            {fit === 'fit-width' ? <UnfoldHorizontal size={18} strokeWidth={1.75} aria-hidden="true" /> : <Maximize size={18} strokeWidth={1.75} aria-hidden="true" />}
          </button>
          {place?.total > 0 && onGoToPage && <PageBox page={place.page} total={place.total} onGo={onGoToPage} inputRef={pageInput} />}
          {onPageView && (
            <select className="rf-tool rf-select" aria-label="Page view" value={pageView} onChange={(event) => onPageView(event.target.value)}>
              {PAGE_VIEWS.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
            </select>
          )}
        </div>
      ) : (
        <div className="rf-toolbar-group" role="group" aria-label="Text">
          {place?.total > 0 && onGoToPage && <PageBox page={place.page} total={place.total} onGo={onGoToPage} approx={place.approx} inputRef={pageInput} />}
          <button type="button" className="rf-tool rf-size rf-size--small" aria-label="Smaller text"
            onClick={() => set({ fontSize: fontStep(size, -1) })} disabled={size <= FONT_SIZES[0]}>A</button>
          <button type="button" className="rf-tool rf-size rf-size--large" aria-label="Larger text"
            onClick={() => set({ fontSize: fontStep(size, 1) })} disabled={size >= FONT_SIZES.at(-1)}>A</button>
          <button type="button" className="rf-tool" onClick={() => set({ lineHeight: next(LINE_HEIGHTS, settings.lineHeight ?? null) })}
            aria-label={`Line spacing: ${settings.lineHeight ?? 'as published'}. Change`}>
            <MoveVertical size={18} strokeWidth={1.75} aria-hidden="true" />
            <span className="rf-tool-value" aria-hidden="true">{settings.lineHeight ?? 'Book'}</span>
          </button>
          <button type="button" className="rf-tool" onClick={() => set({ margins: next(MARGINS, settings.margins) })}
            aria-label={`Margins: ${settings.margins}. Change`}>
            <MoveHorizontal size={18} strokeWidth={1.75} aria-hidden="true" />
            <span className="rf-tool-value" aria-hidden="true">{settings.margins}</span>
          </button>
          <button type="button" className="rf-tool" aria-pressed={settings.style === 'readfocus'}
            onClick={() => set({ style: settings.style === 'readfocus' ? 'publisher' : 'readfocus' })}
            aria-label={settings.style === 'readfocus' ? 'ReadFocus style. Switch to the publisher style' : 'Publisher style. Switch to the ReadFocus style'}>
            <Type size={18} strokeWidth={1.75} aria-hidden="true" />
            <span className="rf-tool-value" aria-hidden="true">{settings.style === 'readfocus' ? 'ReadFocus' : 'Publisher'}</span>
          </button>
        </div>
      )}
      {onFind && (
        <button type="button" className="rf-tool" onClick={onFind} aria-label="Find in the book" aria-keyshortcuts="Control+F"
          title="Find (Ctrl+F)">
          <Search size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}
    </>
  );
}
