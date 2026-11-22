import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { autoUpdate, flip, FloatingPortal, offset, shift, useFloating } from '@floating-ui/react';
import { MessageCircle, MessageSquareText, Plus, Trash2, Underline } from 'lucide-react';
import { useSteveActions } from '../steve/SteveContext';
import { ColourDots } from './ColourDots';
import { colourName } from './palette';
import { rove } from './roving';
import './SelectionToolbar.css';

const SNIPPET = 48;
const snippet = (text) => (text.length > SNIPPET ? `${text.slice(0, SNIPPET - 1).trimEnd()}…` : text);

/**
 * The chip on a highlight (C21.4; handoff screen 18 "Ask Steve chip above its end"): Ask Steve first, then the
 * colours (C39.2: ColourDots, More colours for Edge's other five), Underline and Delete. It sits above the end of
 * the annotation's last line, flipping below at the page's top, never over the line. Ask Steve opens the panel in explain_highlight mode with the annotation's
 * first anchor (the panel shows the consent notice first when it is needed). A chip opened with A takes focus;
 * A moves to the next highlight, Shift+A the previous, Escape returns to the book. `ref` is its element, for the
 * hover rules (useAnnotationChip). A pending (unsaved) annotation can be asked about but not changed yet.
 */
export function AnnotationChip({ annotation, by, rectsOf, onChange, onDelete, onCycle, onClose, onNote = null, onComment = null, ref }) {
  const steve = useSteveActions(); // null while Steve is off: no Ask Steve
  const { refs, floatingStyles, placement } = useFloating({
    placement: 'top-end',
    strategy: 'fixed',
    transform: false,
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 16 })],
    whileElementsMounted: autoUpdate,
  });
  const bar = useRef(null);
  const focusFirst = useRef(false); // a chip opened by key takes focus once its portal has mounted it
  const setFloating = useCallback((el) => {
    bar.current = el;
    if (el && focusFirst.current) {
      focusFirst.current = false;
      el.querySelector('button')?.focus();
    }
    refs.setFloating(el);
    if (typeof ref === 'function') ref(el);
    else if (ref) ref.current = el;
  }, [refs, ref]);
  const { id } = annotation;
  useLayoutEffect(() => {
    refs.setPositionReference({ // the end of the annotation's last line, wherever the page has moved it
      getBoundingClientRect: () => rectsOf(id).at(-1) ?? new DOMRect(),
    });
  }, [refs, rectsOf, id]);
  useEffect(() => {
    if (by !== 'key') return;
    if (bar.current) bar.current.querySelector('button')?.focus();
    else focusFirst.current = true;
  }, [by, id]);

  const { style, color } = annotation;
  const fixed = Boolean(annotation.pending);
  const text = annotation.anchors.map((a) => a.text).join(' ');
  const ask = () => {
    steve.askAbout({ question: 'Explain this passage.', mode: 'explain_highlight', anchor: annotation.anchors[0], label: 'Explain this passage' });
    onClose(false);
  };
  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose(true);
    } else if ((event.key === 'a' || event.key === 'A') && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      onCycle(event.shiftKey ? -1 : 1);
    } else rove(event, bar.current);
  };

  return (
    <FloatingPortal>
      <div ref={setFloating} className="rf-seltool rf-annochip" style={floatingStyles} data-side={placement.split('-')[0]}
        role="toolbar" aria-label={`${colourName(color)} ${style}: ${snippet(text)}`} aria-keyshortcuts="A Shift+A Escape"
        onKeyDown={onKeyDown} onPointerDown={(event) => event.preventDefault()}>
        {steve && (
          <>
            <button type="button" className="rf-seltool-btn" tabIndex={0} aria-label="Ask Steve" onClick={ask}>
              <MessageCircle size={18} strokeWidth={1.75} aria-hidden="true" />
              <span className="rf-seltool-label">Ask Steve</span>
            </button>
            <span className="rf-seltool-sep" aria-hidden="true" />
          </>
        )}
        <ColourDots current={color} pressed firstTab={!steve} disabled={fixed}
          onPick={(c) => c !== color && onChange(id, { color: c })} />
        <button type="button" className="rf-seltool-btn" tabIndex={-1} aria-label="Underline" aria-pressed={style === 'underline'}
          disabled={fixed} onClick={() => onChange(id, { style: style === 'underline' ? 'highlight' : 'underline' })}>
          <Underline size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
        {onComment && (
          // C39.8 (issue 23, D1): its comment, added or edited in place.
          <button type="button" className="rf-seltool-btn" tabIndex={-1} disabled={fixed}
            aria-label={annotation.comment ? 'Edit comment' : 'Add comment'} title={annotation.comment ? 'Edit comment' : 'Add comment'}
            onClick={() => { onComment(id); onClose(false); }}>
            <MessageSquareText size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        )}
        {onNote && (
          // C22.6: a text note quoting this passage, linked to it.
          <button type="button" className="rf-seltool-btn" tabIndex={-1} aria-label="Add note" title="Add note" disabled={fixed}
            onClick={() => { onNote(annotation); onClose(false); }}>
            <Plus size={18} strokeWidth={1.75} aria-hidden="true" />
            <span className="rf-seltool-label">Note</span>
          </button>
        )}
        <span className="rf-seltool-sep" aria-hidden="true" />
        <button type="button" className="rf-seltool-btn" tabIndex={-1} aria-label="Delete" title={`Delete this ${style}`}
          disabled={fixed} onClick={() => { onDelete(id); onClose(by === 'key'); }}>
          <Trash2 size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
    </FloatingPortal>
  );
}
