import { cloneElement, useEffect, useId, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { fadeIn } from '../../motion/presets';
import './Tooltip.css';

/**
 * Dark tooltip with a pointer, above its trigger ("4 pages left in
 * today's reading"). Opens on hover (after 200 ms) and on keyboard focus,
 * closes on Esc, blur or leaving; it stays open while the pointer is over
 * it (WCAG 1.4.13). The trigger is described by a persistent hidden copy
 * of the text (aria-describedby); the visible bubble is aria-hidden. The
 * child must be a focusable element that accepts props.
 */
export function Tooltip({ content, children, delay = 200 }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [wait, setWait] = useState(null); // ms until it opens, or null

  useEffect(() => {
    if (wait === null) return undefined;
    const timer = setTimeout(() => setOpen(true), wait);
    return () => clearTimeout(timer);
  }, [wait]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') { setWait(null); setOpen(false); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const hide = () => { setWait(null); setOpen(false); };

  return (
    <span className="rf-tooltip-anchor" onMouseEnter={() => setWait(delay)} onMouseLeave={hide}>
      {cloneElement(children, {
        'aria-describedby': id,
        onFocus: (e) => { children.props.onFocus?.(e); setWait(0); },
        onBlur: (e) => { children.props.onBlur?.(e); hide(); },
      })}
      <span id={id} className="rf-visually-hidden">{content}</span>
      <AnimatePresence>
        {open && (
          <m.span key="tip" className="rf-tooltip" aria-hidden="true" variants={fadeIn} initial="hidden" animate="visible" exit="exit">
            {content}
          </m.span>
        )}
      </AnimatePresence>
    </span>
  );
}
