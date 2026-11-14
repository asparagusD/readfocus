import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchApi } from '../lib/api';
import { useToast } from '../components/ui/toastContext';
import { ACTION_LABEL, actionsFor, elementPath, regionLabel } from './blocks';
import { imageToPng } from './crop';
import { latexOf } from './latexLocal';
import { LatexDialog } from './LatexDialog';
import { useSteveActions } from './SteveContext';
import './BlockActions.css';

const HIDE_MS = 350;
const BLOCKS = 'math, pre, figure, img';
const MATHML = 'http://www.w3.org/1998/Math/MathML';

/** The block an EPUB element belongs to: an equation, a code listing or a figure (an image alone counts). */
function blockOf(target) {
  const el = target?.closest?.(BLOCKS);
  if (!el) return null;
  const name = el.localName;
  if (name === 'math' || el.namespaceURI === MATHML) return { el, kind: 'math' };
  if (name === 'pre') return { el, kind: 'code' };
  const figure = name === 'img' ? el.closest('figure') ?? el : el;
  return figure.querySelector?.('img') || figure.localName === 'img' ? { el: figure, kind: 'figure' } : null;
}

/**
 * Block actions in an EPUB (C20.8c, docs/STEVE.md S14): an equation, code listing or figure in a section shows its
 * actions on hover, a tap, or keyboard focus (each block is made focusable; Enter moves to its actions). Copy as
 * LaTeX and Copy code stay on the device; Explain asks Steve with the region the server knows at that place (found
 * by section and element path), the source itself when there is none, and a figure's image file.
 */
export function EpubBlockActions({ sections, spineOf, bookId, paused }) {
  const steve = useSteveActions();
  const { toast } = useToast();
  const [active, setActive] = useState(null); // { doc, el, kind }
  const [latex, setLatex] = useState(null);
  const hide = useRef(0);
  const bar = useRef(null);
  const quiet = useRef(false); // Esc returns focus to the block without opening its actions again

  const later = useCallback(() => {
    clearTimeout(hide.current);
    hide.current = setTimeout(() => setActive(null), HIDE_MS);
  }, []);
  const stay = useCallback(() => clearTimeout(hide.current), []);
  useEffect(() => () => clearTimeout(hide.current), []);

  useEffect(() => {
    if (paused) return undefined;
    const off = sections.filter((doc) => doc.body).map((doc) => {
      for (const el of doc.querySelectorAll(BLOCKS)) {
        const block = blockOf(el);
        if (block?.el === el && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
      }
      const show = (event) => {
        if (event.type === 'focusin' && quiet.current) { quiet.current = false; return; }
        const block = blockOf(event.target);
        if (block) {
          stay();
          setActive((now) => (now?.el === block.el ? now : { doc, ...block }));
        } else later();
      };
      const onKey = (event) => {
        if (event.key === 'Enter' && blockOf(event.target)?.el === event.target) {
          event.preventDefault();
          bar.current?.querySelector('button')?.focus();
        }
      };
      doc.addEventListener('pointerover', show);
      doc.addEventListener('pointerdown', show);
      doc.addEventListener('focusin', show);
      doc.addEventListener('keydown', onKey);
      doc.body.addEventListener('pointerleave', later);
      return () => {
        doc.removeEventListener('pointerover', show);
        doc.removeEventListener('pointerdown', show);
        doc.removeEventListener('focusin', show);
        doc.removeEventListener('keydown', onKey);
        doc.body.removeEventListener('pointerleave', later);
      };
    });
    return () => off.forEach((fn) => fn());
  }, [sections, paused, later, stay]);

  const shown = !paused && active && sections.includes(active.doc) && active.el.isConnected ? active : null;

  const regionAt = async (block) => {
    const spine = spineOf(block.doc);
    if (spine == null) return { spine: null, region: null };
    try {
      const path = elementPath(block.el);
      return { spine, region: await fetchApi(`/books/${bookId}/region-at?spine_index=${spine}&path=${encodeURIComponent(path)}`) };
    } catch {
      return { spine, region: null }; // a block the region map does not know: its own text is sent instead
    }
  };

  const run = async (action, block) => {
    try {
      if (action === 'copy_code') {
        await navigator.clipboard.writeText(block.el.textContent);
        toast({ kind: 'success', message: 'Code copied.' });
        return;
      }
      if (action === 'copy_latex') {
        setLatex({ loading: true });
        const tex = await latexOf(block.el);
        setLatex(tex ? { latex: tex, source: 'book' } : { error: 'This equation could not be read as LaTeX.' });
        return;
      }
      const { spine, region } = await regionAt(block);
      const label = regionLabel(block.kind, spine == null ? 'this section' : `sec. ${spine + 1}`);
      if (action === 'explain_figure') {
        const img = block.el.localName === 'img' ? block.el : block.el.querySelector('img');
        steve.askAbout({ question: 'Explain this figure.', mode: 'explain_figure', regionId: region?.id,
          imagePngB64: await imageToPng(img), label });
      } else if (action === 'explain_equation') {
        steve.askAbout(region ? { question: 'Explain this equation.', mode: 'explain_equation', regionId: region.id, label }
          : { question: `Explain this equation: $$${await latexOf(block.el)}$$`, label });
      } else if (action === 'explain_code') {
        steve.askAbout(region ? { question: 'Explain this code.', mode: 'explain_code', regionId: region.id, label }
          : { question: `Explain this code:\n\`\`\`\n${block.el.textContent}\n\`\`\``, label });
      }
    } catch (error) {
      if (action === 'copy_latex') setLatex({ error: error.message || 'This equation could not be read.' });
      else toast({ kind: 'warning', message: error.message || 'That did not work. Try again.' });
    }
  };

  let barNode = null;
  if (shown) {
    const frame = shown.doc.defaultView?.frameElement?.getBoundingClientRect() ?? { left: 0, top: 0 };
    const r = shown.el.getBoundingClientRect();
    const style = { left: frame.left + r.left, top: frame.top + r.top, width: r.width, height: r.height };
    const actions = actionsFor(shown.kind, { steve: Boolean(steve), format: 'epub' });
    if (actions.length) {
      barNode = createPortal(
        <div className="rf-block rf-block--fixed" style={style}>
          <div ref={bar} className="rf-block-bar" role="toolbar" aria-label={regionLabel(shown.kind, 'this page')}
            data-below={style.top < 120} data-align={style.left + style.width / 2 > window.innerWidth / 2 ? 'end' : 'start'}
            onPointerEnter={stay} onPointerLeave={later} onFocus={stay}
            onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) later(); }}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              event.stopPropagation();
              setActive(null);
              quiet.current = true;
              shown.el.focus?.();
            }}>
            {actions.map((action) => (
              <button key={action} type="button" className="rf-block-act" onClick={() => run(action, shown)}>
                {ACTION_LABEL[action]}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      );
    }
  }

  return (
    <>
      {barNode}
      <LatexDialog state={latex} onClose={() => setLatex(null)} />
    </>
  );
}
