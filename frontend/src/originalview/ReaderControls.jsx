import { MoveHorizontal, MoveVertical, Palette, Type, ZoomIn, ZoomOut } from 'lucide-react';
import { zoomLabel, zoomStep } from './frame';

const SIZES = [14, 16, 18, 20, 22, 24];
const LINE_HEIGHTS = [null, 1.45, 1.65, 1.85]; // null: the publisher's own
const MARGINS = ['narrow', 'normal', 'wide'];
const next = (list, value) => list[(list.indexOf(value) + 1) % list.length];

/**
 * The original view's controls for the reader toolbar (C17.4): zoom out, zoom level
 * (fit page, fit width, 125-200 %; click to cycle the fits) and zoom in for a PDF;
 * smaller and larger text, line spacing and margins for an EPUB; and in lamplight a
 * per-book "Original colours" switch.
 */
export function ReaderControls({ kind, zoom, onZoom, settings, onSettings, lamplight, original, onOriginal }) {
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
        </div>
      ) : (
        <div className="rf-toolbar-group" role="group" aria-label="Text">
          <button type="button" className="rf-tool rf-size rf-size--small" aria-label="Smaller text"
            onClick={() => set({ fontSize: SIZES[Math.max(0, SIZES.indexOf(size) - 1)] })} disabled={size <= SIZES[0]}>A</button>
          <button type="button" className="rf-tool rf-size rf-size--large" aria-label="Larger text"
            onClick={() => set({ fontSize: SIZES[Math.min(SIZES.length - 1, SIZES.indexOf(size) + 1)] })} disabled={size >= SIZES.at(-1)}>A</button>
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
      {lamplight && (
        <button type="button" role="switch" aria-checked={original} className="rf-tool rf-switch" onClick={onOriginal}
          aria-label="Show this book in its original colours">
          <Palette size={18} strokeWidth={1.75} aria-hidden="true" />
          <span className="rf-tool-label" aria-hidden="true">Original colours</span>
          <span className="rf-switch-track" aria-hidden="true"><span className="rf-switch-knob" /></span>
        </button>
      )}
    </>
  );
}
