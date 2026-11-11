import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import { fadeIn, pop } from '../../motion/presets';
import './Modal.css';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog from the handoff. `role="dialog"`, `aria-modal`, named by
 * `title` (rendered as its heading), by `label`, or by the first heading
 * in the children. While open: focus moves inside and Tab cycles there,
 * Esc and the scrim call onClose, the page does not scroll; on close focus
 * returns to where it was. Arrives with `pop` (opacity only under reduced
 * motion).
 */
export function Modal({ isOpen, onClose, title, label, children }) {
  const panelRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const pressedScrim = useRef(false);
  const titleId = useId();
  const reduced = useReducedMotion();

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const returnTo = document.activeElement;
    const panel = panelRef.current;
    const heading = !title && !label && panel?.querySelector('h1, h2, h3');
    if (heading) {
      heading.id ||= `${titleId}-h`;
      panel.setAttribute('aria-labelledby', heading.id);
    }
    (panel?.querySelector('[autofocus]') ?? panel?.querySelector(FOCUSABLE) ?? panel)?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current?.(); return; }
      if (e.key !== 'Tab' || !panel) return;
      const items = [...panel.querySelectorAll(FOCUSABLE)];
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0];
      const last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      if (returnTo instanceof HTMLElement) returnTo.focus();
    };
  }, [isOpen, title, label, titleId]);

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <m.div
          key="scrim"
          className="rf-modal-scrim"
          variants={fadeIn}
          initial="hidden"
          animate="visible"
          exit="exit"
          onPointerDown={(e) => { pressedScrim.current = e.target === e.currentTarget; }}
          onClick={(e) => { if (pressedScrim.current && e.target === e.currentTarget) onCloseRef.current?.(); }}
        >
          <m.div
            ref={panelRef}
            className="rf-modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            aria-label={!title ? label : undefined}
            tabIndex={-1}
            variants={reduced ? fadeIn : pop}
          >
            {title && <h2 id={titleId} className="rf-modal-title">{title}</h2>}
            {children}
          </m.div>
        </m.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
