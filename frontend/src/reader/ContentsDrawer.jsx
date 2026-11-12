import { useEffect, useRef } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { X } from 'lucide-react';
import { easing, seconds } from '../motion/presets';
import './ContentsDrawer.css';

const narrow = () => typeof window !== 'undefined' && window.matchMedia('(width < 640px)').matches;

/**
 * The book's contents (C12.5b, D4): a drawer that slides in from the left
 * (a sheet from the bottom on phones) over the reader without leaving the
 * page. Since C17.5 the entries are the book's own (the PDF outline or the
 * EPUB nav), each { key, title, today }; today's carry a quiet "today" label
 * and the current one is marked. Picking one calls onPick; Esc, the close
 * button or a click outside closes it, and focus returns to `returnTo`.
 */
export function ContentsDrawer({ open, onClose, entries, current, onPick, returnTo }) {
  const panel = useRef(null);
  const sheet = narrow();
  useEffect(() => {
    if (!open) return undefined;
    // D4: the toolbar stays visible while Contents is open, so the side drawer starts below its row.
    const toolbar = returnTo.current?.closest('.rf-toolbar')?.getBoundingClientRect();
    if (!sheet && toolbar && panel.current) panel.current.style.top = `${Math.round(toolbar.bottom + 8)}px`;
    const first = panel.current?.querySelector('[aria-current="true"]') || panel.current?.querySelector('button');
    first?.focus();
    const onKey = (event) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } };
    const onDown = (event) => {
      if (!panel.current?.contains(event.target) && !returnTo.current?.contains(event.target)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    const button = returnTo.current;
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
      button?.focus();
    };
  }, [open, onClose, returnTo, sheet]);

  const transition = { duration: seconds('--dur-3'), ease: easing('--ease-settle') };
  const away = sheet ? { y: '100%' } : { x: '-100%' };

  return (
    <AnimatePresence>
      {open && (
        <m.aside
          key="contents"
          ref={panel}
          className="rf-contents"
          data-sheet={sheet}
          role="dialog"
          aria-label="Contents"
          initial={away}
          animate={{ x: 0, y: 0 }}
          exit={away}
          transition={transition}
        >
          <div className="rf-contents-head">
            <h2 className="rf-contents-title">Contents</h2>
            <button type="button" className="rf-tool" onClick={onClose} aria-label="Close contents">
              <X size={18} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
          {entries.length ? (
            <ol className="rf-contents-list">
              {entries.map((entry) => {
                const here = entry.title === current;
                return (
                  <li key={entry.key}>
                    <button type="button" className="rf-contents-item" aria-current={here ? 'true' : undefined} onClick={() => onPick(entry)}>
                      <span className="rf-contents-name">{entry.title}</span>
                      {entry.today && <span className="rf-contents-today">today</span>}
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="rf-contents-empty">This book has no chapters we could find. Its pages are still all here.</p>
          )}
        </m.aside>
      )}
    </AnimatePresence>
  );
}
