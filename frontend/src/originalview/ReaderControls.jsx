import { useState } from 'react';
import { MoveHorizontal, MoveVertical, Search, Type, ZoomIn, ZoomOut } from 'lucide-react';
import { FONT_SIZES, fontStep, zoomLabel, zoomStep } from './frame';

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
 * The original view's controls for the reader toolbar (C17.4): zoom out, zoom level
 * (fit page, fit width, 125-200 %; click to cycle the fits) and zoom in for a PDF;
 * smaller and larger text, line spacing and margins for an EPUB. C38.3: the "Original
 * colours" switch is gone: a book is never recoloured. C38.4a (issue 22): a PDF also has Edge's page box (`place`,
 * `onGoToPage`) and Page view (`pageView`, `onPageView`). C38.7b: an EPUB has the page box too, its counted pages ("of
 * ~210": they count characters). C38.9: `pageInput` is the page box's input, for Ctrl+Alt+G. C38.5: Find (`onFind`, also Ctrl+F); C38.5c: for an EPUB too.
 */
export function ReaderControls({ kind, zoom, onZoom, settings, onSettings, place = null, onGoToPage = null, pageView = 'one', onPageView = null, onFind = null, pageInput = null }) {
  const set = (patch) => onSettings({ ...settings, ...patch });
  const size = settings?.fontSize ?? 18;
  return (
    <>
      {kind === 'pdf' ? (
        <div className="rf-toolbar-group" role="group" aria-label="Zoom">
          <button type="button" className="rf-tool" onClick={() => onZoom(zoomStep(zoom, -1))} disabled={zoom === 'fit-page'} aria-label="Zoom out">
            <ZoomOut size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button type="button" className="rf-tool rf-zoom-level" aria-label={`Zoom: ${zoomLabel(zoom)}. Switch between fit page and fit width`}
            onClick={() => onZoom(zoom === 'fit-page' ? 'fit-width' : 'fit-page')}>
            {zoomLabel(zoom)}
          </button>
          <button type="button" className="rf-tool" onClick={() => onZoom(zoomStep(zoom, 1))} disabled={zoom === 2} aria-label="Zoom in">
            <ZoomIn size={18} strokeWidth={1.75} aria-hidden="true" />
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
