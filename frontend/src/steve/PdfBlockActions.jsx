import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { API_BASE_URL, fetchApi } from '../lib/api';
import { supabase } from '../lib/supabase';
import { useToast } from '../components/ui/toastContext';
import { toPagePoint } from '../originalview/pdf/regions';
import { ACTION_LABEL, actionsFor, regionLabel } from './blocks';
import { cropPdfRegion } from './crop';
import { LatexDialog } from './LatexDialog';
import { postSteve } from './sse';
import { useSteveActions } from './SteveContext';
import './BlockActions.css';

const HIDE_MS = 350;
const QUESTION = {
  explain_equation: 'Explain this equation.',
  explain_code: 'Explain this code.',
  explain_figure: 'Explain this figure.',
};

/** The shown PDF pages that are drawn (they carry data-scale), by page number. */
function drawnPages(box, pages) {
  const out = new Map();
  for (const n of pages) {
    const el = box?.querySelector(`.rf-pdf-page[data-page="${n}"][data-scale]`);
    if (el) out.set(n, el);
  }
  return out;
}

/**
 * Block actions on a PDF (C20.8b, docs/STEVE.md S14, handoff "Block affordances"): an equation, code listing or
 * figure from the region map shows its actions on hover, on a tap, or when its outline gets keyboard focus (each
 * whole region has a focusable outline over it that lets pointer events through to the text layer). Explain asks
 * Steve with a crop of the page or the region id; Copy code copies the exact text; Copy as LaTeX asks
 * /steve/latex (once per equation, ever) and shows a KaTeX preview.
 */
export function PdfBlockActions({ box, regions, bookId, pages, paused }) {
  const steve = useSteveActions();
  const { toast } = useToast();
  const [, setVersion] = useState(0);
  const [active, setActive] = useState(null); // { page, region }
  const [latex, setLatex] = useState(null);
  const hide = useRef(0);
  const quiet = useRef(false); // Esc returns focus to the outline without opening the actions again
  const pageNumbers = pages ? pages.split(',').map(Number) : [];

  useEffect(() => regions.subscribe(() => setVersion((v) => v + 1)), [regions]);
  useEffect(() => { // a page gets data-scale when it is drawn: draw its outlines then
    if (!box) return undefined;
    const watch = new MutationObserver(() => setVersion((v) => v + 1));
    watch.observe(box, { attributes: true, attributeFilter: ['data-scale'], subtree: true });
    return () => watch.disconnect();
  }, [box]);

  const later = useCallback(() => {
    clearTimeout(hide.current);
    hide.current = setTimeout(() => setActive(null), HIDE_MS);
  }, []);
  const stay = useCallback(() => clearTimeout(hide.current), []);

  useEffect(() => {
    if (!box || paused) return undefined;
    const at = (event) => {
      const pageEl = event.target.closest?.('.rf-pdf-page[data-scale]');
      if (!pageEl) return null;
      const page = Number(pageEl.dataset.page);
      const p = toPagePoint(pageEl.getBoundingClientRect(), Number(pageEl.dataset.scale), event.clientX, event.clientY);
      const region = regions.regionAt(page, p.x, p.y);
      return region ? { page, region } : null;
    };
    const onMove = (event) => {
      if (event.target.closest?.('.rf-block-bar')) return;
      const found = at(event);
      if (found) {
        stay();
        setActive((now) => (now?.region.id === found.region.id ? now : found));
      } else later();
    };
    box.addEventListener('pointermove', onMove);
    box.addEventListener('pointerdown', onMove); // a tap shows them on touch
    box.addEventListener('pointerleave', later); // off the book altogether
    return () => {
      box.removeEventListener('pointermove', onMove);
      box.removeEventListener('pointerdown', onMove);
      box.removeEventListener('pointerleave', later);
    };
  }, [box, regions, paused, later, stay]);

  useEffect(() => () => clearTimeout(hide.current), []);

  const pagesNow = drawnPages(box, pageNumbers);
  // A turn or a pause puts the actions away: only a region on a page shown now keeps them.
  const shown = !paused && active && pagesNow.has(active.page) ? active : null;

  const run = async (action, { page, region }) => {
    const pageEl = pagesNow.get(page);
    const label = regionLabel(region.kind, `p. ${page}`);
    try {
      if (action === 'copy_code') {
        const detail = await fetchApi(`/books/${bookId}/regions/${region.id}`);
        await navigator.clipboard.writeText(detail.text ?? '');
        toast({ kind: 'success', message: 'Code copied.' });
        return;
      }
      if (action === 'copy_latex') {
        setLatex({ loading: true });
        const { data: { session } } = await supabase.auth.getSession();
        const body = { book_id: bookId, region_id: region.id, image_png_b64: cropPdfRegion(pageEl, region.bbox),
          utc_offset_minutes: -new Date().getTimezoneOffset() };
        const found = await postSteve({ url: `${API_BASE_URL}/steve/latex`, token: session?.access_token, body });
        setLatex({ latex: found.latex, source: found.cached ? 'cached' : 'steve' });
        return;
      }
      const imagePngB64 = action === 'explain_code' ? undefined : cropPdfRegion(pageEl, region.bbox);
      steve.askAbout({ question: QUESTION[action], mode: action, regionId: region.id, imagePngB64, label });
    } catch (error) {
      if (action === 'copy_latex') setLatex({ error: error.message || 'The equation could not be read.' });
      else toast({ kind: 'warning', message: error.message || 'That did not work. Try again.' });
    }
  };

  const outlines = [];
  for (const [page, pageEl] of pagesNow) {
    const scale = Number(pageEl.dataset.scale);
    for (const region of regions.regionsOf(page)) {
      if (!actionsFor(region.kind, { steve: Boolean(steve) }).length) continue;
      const [x0, top, x1, bottom] = region.bbox;
      const style = { left: x0 * scale, top: top * scale, width: (x1 - x0) * scale, height: (bottom - top) * scale };
      const on = shown?.region.id === region.id;
      // The outline and its bar share one wrapper, so Tab goes from the outline straight to its actions.
      outlines.push(createPortal(
        <div key={region.id} className="rf-block" style={style}
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || !on) return;
            event.stopPropagation();
            setActive(null);
            quiet.current = true;
            event.currentTarget.querySelector('.rf-block-hit')?.focus();
          }}>
          <button type="button" className="rf-block-hit" data-on={on}
            aria-label={`${regionLabel(region.kind, `page ${page}`)}: actions`}
            onFocus={() => {
              if (quiet.current) { quiet.current = false; return; }
              stay();
              setActive({ page, region });
            }}
            onBlur={(event) => { if (!event.currentTarget.parentElement.contains(event.relatedTarget)) later(); }} />
          {on && (
            <div className="rf-block-bar" role="toolbar" aria-label={regionLabel(region.kind, `page ${page}`)}
              data-below={top * scale < 48} data-align={x1 * scale > pageEl.clientWidth / 2 ? 'end' : 'start'}
              onPointerEnter={stay} onPointerLeave={later} onFocus={stay}
              onBlur={(event) => { if (!event.currentTarget.parentElement.contains(event.relatedTarget)) later(); }}>
              {actionsFor(region.kind, { steve: Boolean(steve) }).map((action) => (
                <button key={action} type="button" className="rf-block-act" onClick={() => run(action, { page, region })}>
                  {ACTION_LABEL[action]}
                </button>
              ))}
            </div>
          )}
        </div>,
        pageEl, region.id,
      ));
    }
  }

  return (
    <>
      {outlines}
      <LatexDialog state={latex} onClose={() => setLatex(null)} />
    </>
  );
}
