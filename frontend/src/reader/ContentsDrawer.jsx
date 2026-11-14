import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { X } from 'lucide-react';
import { easing, seconds } from '../motion/presets';
import { COLOURS, colourName } from '../annotations/palette';
import { listed, snippetOf } from '../annotations/list';
import { rove } from '../annotations/roving';
import './ContentsDrawer.css';

const narrow = () => typeof window !== 'undefined' && window.matchMedia('(width < 640px)').matches;

/**
 * The book's contents (C12.5b, D4): a drawer that slides in from the left
 * (a sheet from the bottom on phones) over the reader without leaving the
 * page. Since C17.5 the entries are the book's own (the PDF outline or the
 * EPUB nav), each { key, title, today }; today's carry a quiet "today" label
 * and the current one is marked. Picking one calls onPick; Esc, the close
 * button or a click outside closes it, and focus returns to `returnTo`.
 * C21.5: an Annotations tab beside Contents: the reader's highlights and underlines in reading order, each with
 * its colour, snippet and page (`pageOf(annotation)`), a colour filter, and a jump to the passage (`onPickAnnotation`).
 */
export function ContentsDrawer({ open, onClose, entries, current, onPick, returnTo, annotations = null, pageOf, onPickAnnotation }) {
  const panel = useRef(null);
  const [tab, setTab] = useState('contents');
  const [colour, setColour] = useState(null);
  const sheet = narrow();
  useEffect(() => {
    if (!open) return undefined;
    // D4: the toolbar stays visible while Contents is open, so the side drawer starts below its row.
    const toolbar = returnTo.current?.closest('.rf-toolbar')?.getBoundingClientRect();
    if (!sheet && toolbar && panel.current) panel.current.style.top = `${Math.round(toolbar.bottom + 8)}px`;
    const first = panel.current?.querySelector('[role="tabpanel"] [aria-current="true"]') || panel.current?.querySelector('[role="tab"][aria-selected="true"]');
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
          {annotations && (
            <div className="rf-contents-tabs" role="tablist" aria-label="Show" onKeyDown={(event) => rove(event, event.currentTarget)}>
              {[['contents', 'Contents'], ['annotations', 'Annotations']].map(([id, name]) => (
                <button key={id} type="button" role="tab" id={`rf-tab-${id}`} aria-controls={`rf-tabpanel-${id}`}
                  aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} className="rf-contents-tab" onClick={() => setTab(id)}>
                  {name}{id === 'annotations' && <> <span className="rf-contents-count">{annotations.length}</span></>}
                </button>
              ))}
            </div>
          )}
          {tab === 'contents' || !annotations ? (
            <div className="rf-contents-panel" role={annotations ? 'tabpanel' : undefined} id="rf-tabpanel-contents"
              aria-labelledby={annotations ? 'rf-tab-contents' : undefined}>
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
            </div>
          ) : (
            <AnnotationsPanel annotations={annotations} colour={colour} onColour={setColour} pageOf={pageOf} onPick={onPickAnnotation} />
          )}
        </m.aside>
      )}
    </AnimatePresence>
  );
}

/** The Annotations tab (C21.5): a colour filter, then the list in reading order; a pick jumps to the passage. */
function AnnotationsPanel({ annotations, colour, onColour, pageOf, onPick }) {
  const shown = listed(annotations, colour);
  const choices = [[null, 'All'], ...COLOURS.map((c) => [c, colourName(c)])];
  return (
    <div className="rf-contents-panel" role="tabpanel" id="rf-tabpanel-annotations" aria-labelledby="rf-tab-annotations">
      <div className="rf-anno-filter" role="radiogroup" aria-label="Colour" onKeyDown={(event) => rove(event, event.currentTarget)}>
        {choices.map(([c, name]) => (
          <button key={name} type="button" role="radio" aria-checked={colour === c} tabIndex={colour === c ? 0 : -1}
            aria-label={name} data-colour={c ?? undefined} className={c ? 'rf-anno-filter-dot' : 'rf-anno-filter-all'}
            onClick={() => onColour(c)}>
            {c ? <span aria-hidden="true" /> : name}
          </button>
        ))}
      </div>
      {shown.length ? (
        <ol className="rf-contents-list">
          {shown.map((a) => {
            const page = pageOf?.(a) ?? '';
            const text = snippetOf(a);
            return (
              <li key={a.id}>
                <button type="button" className="rf-contents-item rf-anno-item" onClick={() => onPick(a)}
                  aria-label={`${colourName(a.color)} ${a.style}${page ? `, ${page}` : ''}: ${text}`}>
                  <span className="rf-anno-mark" data-style={a.style} data-colour={a.color} aria-hidden="true" />
                  <span className="rf-anno-text">{text}</span>
                  {page && <span className="rf-contents-today">{page}</span>}
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="rf-contents-empty">
          {annotations.length ? `No ${colour} highlights.` : 'No highlights yet. Select a passage in the book to highlight it.'}
        </p>
      )}
    </div>
  );
}
