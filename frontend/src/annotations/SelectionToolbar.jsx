import { useCallback, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { autoUpdate, flip, FloatingPortal, offset, shift, useFloating } from '@floating-ui/react';
import { MessageCircle, Underline } from 'lucide-react';
import { outerBox } from '../reader/highlight';
import { useSteveActions } from '../steve/SteveContext';
import { COLOURS, colourName, lastColour, newAnnotation, storeLastColour } from './palette';
import { rove } from './roving';
import './SelectionToolbar.css';

/**
 * The selection toolbar (C21.2, handoff screen 18): five colour dots, an Underline toggle and Ask Steve over a
 * settled selection, never on it: above for a mouse, below for touch (the platform's own menu and handles sit
 * above), flipping at the page's edge. A colour saves at once (optimistic, `onAnnotate`) and closes it; the
 * selection is cleared. Keyboard (`ref`): H highlights and U underlines in the last colour, Tab moves into the
 * bar, arrows move along it, Escape puts it away and returns to the book. "Add note" waits for the notepad (C22).
 */
export function SelectionToolbar({ place, onAnnotate, onDismiss, returnFocusTo, ref }) {
  const actions = useSteveActions();
  const steve = actions?.enabled === false ? null : actions; // hidden while Steve is off (steve-guardrails S2)
  const [toggled, setToggled] = useState(null); // the selection whose Underline is pressed
  const [said, setSaid] = useState('');
  const [last, setLast] = useState(lastColour);
  const bar = useRef(null);
  const touch = Boolean(place?.touch);
  const { refs, floatingStyles, placement } = useFloating({
    placement: touch ? 'bottom' : 'top',
    strategy: 'fixed',
    transform: false,
    middleware: [offset(touch ? 56 : 8), flip({ padding: 8 }), shift({ padding: 16 })], // 56: past the Look up chip
    whileElementsMounted: autoUpdate,
  });
  const setFloating = useCallback((el) => { bar.current = el; refs.setFloating(el); }, [refs]);
  useLayoutEffect(() => { if (place) refs.setPositionReference(outerBox(place.range)); }, [refs, place]);
  const underline = Boolean(place) && toggled === place.key;

  const back = () => {
    if (bar.current?.contains(document.activeElement)) returnFocusTo?.current?.focus();
  };

  const annotate = (colour, style) => {
    if (!place) return;
    storeLastColour(colour);
    setLast(colour);
    back();
    place.doc.getSelection()?.removeAllRanges();
    onDismiss(false);
    setSaid('');
    onAnnotate(newAnnotation(place, colour, style)).then((saved) => {
      if (saved) setSaid(`${style === 'underline' ? 'Underlined' : 'Highlighted'} in ${colourName(colour)}.`);
    });
  };

  const ask = () => {
    steve.askAbout({ question: 'Explain this passage.', mode: 'explain_highlight', anchor: place.anchors[0], label: 'Explain this passage' });
    back();
    onDismiss();
  };

  useImperativeHandle(ref, () => ({
    /** Keys from the book: true when the toolbar used the key. */
    onKey(event) {
      if (!place || event.ctrlKey || event.metaKey || event.altKey) return false;
      const key = event.key.toLowerCase();
      if (key === 'h' || (key === 'u' && place.prose)) annotate(lastColour(), key === 'u' ? 'underline' : 'highlight');
      else if (event.key === 'Tab' && !event.shiftKey) bar.current?.querySelector('button[tabindex="0"]')?.focus();
      else return false;
      event.preventDefault();
      return true;
    },
  }));

  // One tab stop; arrows, Home and End move along the bar (roving.js).
  const onKeyDown = (event) => {
    const first = bar.current.querySelector('button:not(:disabled)');
    if (event.key === 'Escape' || (event.key === 'Tab' && event.shiftKey && document.activeElement === first)) {
      event.preventDefault();
      back();
      if (event.key === 'Escape') onDismiss();
      return;
    }
    rove(event, bar.current);
  };

  const style = underline ? 'underline' : 'highlight';
  return (
    <>
      <p className="sr-only" role="status">{said}</p>
      {place && (
        <FloatingPortal>
          <div ref={setFloating} className="rf-seltool" style={floatingStyles} data-side={placement.split('-')[0]}
            role="toolbar" aria-label="Highlight the selection" aria-keyshortcuts="H U" onKeyDown={onKeyDown}
            onPointerDown={(event) => event.preventDefault()} /* a press here keeps the selection */>
            {COLOURS.map((colour, i) => (
              <button key={colour} type="button" className="rf-seltool-dot" data-colour={colour} tabIndex={i === 0 ? 0 : -1}
                data-last={colour === last || undefined} aria-label={`${colourName(colour)} ${style}`}
                title={colour === last ? `${colourName(colour)} (${underline ? 'U' : 'H'})` : colourName(colour)}
                onClick={() => annotate(colour, style)}>
                <span aria-hidden="true" />
              </button>
            ))}
            <button type="button" className="rf-seltool-btn" tabIndex={-1} aria-label="Underline" aria-pressed={underline}
              disabled={!place.prose} title={place.prose ? 'Underline (U)' : 'Underline is for running text'}
              onClick={() => setToggled(underline ? null : place.key)}>
              <Underline size={18} strokeWidth={1.75} aria-hidden="true" />
            </button>
            {steve && (
              <>
                <span className="rf-seltool-sep" aria-hidden="true" />
                <button type="button" className="rf-seltool-btn" tabIndex={-1} aria-label="Ask Steve" onClick={ask}>
                  <MessageCircle size={18} strokeWidth={1.75} aria-hidden="true" />
                  <span className="rf-seltool-label">Ask Steve</span>
                </button>
              </>
            )}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
