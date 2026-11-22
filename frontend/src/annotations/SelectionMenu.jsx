import { useCallback, useLayoutEffect, useRef } from 'react';
import { autoUpdate, flip, FloatingPortal, offset, shift, useFloating } from '@floating-ui/react';
import { useSteveActions } from '../steve/SteveContext';
import { colourName, FIRST_COLOURS, lastColour, newAnnotation, storeLastColour } from './palette';
import './SelectionToolbar.css';

const ITEMS = '[role^="menuitem"]:not(:disabled)';

/**
 * Edge's right-click menu on a selection (C39.7, issue 23): Highlight in the last colour (H) or one of the first five,
 * Underline (U, running text only), Add note (N), Ask Steve (when he is on), Look up, Copy. Opened at the pointer by
 * a right-click, or by the menu key or Shift+F10 at the selection's end (`menu`: { place, x, y }). Arrow keys, Home
 * and End move through it; Enter or a click runs an item and closes it; Escape or Tab closes it and gives the book
 * focus (`onClose(true)`); a press outside closes it. Read aloud from here comes with C40.
 */
export function SelectionMenu({ menu, onClose, onAnnotate, onNote = null, onLookUp = null }) {
  const steve = useSteveActions();
  const box = useRef(null);
  const { refs, floatingStyles } = useFloating({
    placement: 'bottom-start', strategy: 'fixed', transform: false,
    middleware: [offset(4), flip({ padding: 8 }), shift({ padding: 8 })], whileElementsMounted: autoUpdate,
  });
  const setFloating = useCallback((el) => { // the portal mounts it after the effects: focus its first item then
    box.current = el;
    refs.setFloating(el);
    el?.querySelector(ITEMS)?.focus();
  }, [refs]);
  useLayoutEffect(() => {
    if (!menu) return undefined;
    refs.setPositionReference({ getBoundingClientRect: () => new DOMRect(menu.x, menu.y, 0, 0) });
    const away = (event) => { if (!box.current?.contains(event.target)) onClose(false); };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [menu, refs, onClose]);
  if (!menu) return null;
  const { place } = menu;

  const run = (action, { keep = false, book = false } = {}) => () => {
    action();
    if (!keep) place.doc.getSelection()?.removeAllRanges();
    onClose(book);
  };
  const annotate = (colour, style) => run(() => {
    storeLastColour(colour);
    onAnnotate(newAnnotation(place, colour, style));
  }, { book: true });
  const copy = run(() => {
    const text = place.doc.getSelection()?.toString() || place.anchors.map((a) => a.text).join(' ');
    (navigator.clipboard?.writeText(text) ?? Promise.reject()).catch(() => place.doc.execCommand?.('copy'));
  }, { keep: true, book: true });
  const last = lastColour();

  const onKeyDown = (event) => {
    const items = [...box.current.querySelectorAll(ITEMS)];
    const at = items.indexOf(document.activeElement);
    const to = { ArrowDown: at + 1, ArrowRight: at + 1, ArrowUp: at - 1, ArrowLeft: at - 1, Home: 0, End: items.length - 1 }[event.key];
    if (to !== undefined) {
      event.preventDefault();
      items[(to + items.length) % items.length]?.focus();
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
    }
  };

  return (
    <FloatingPortal>
      <div ref={setFloating} className="rf-selmenu" role="menu" aria-label="Selection" style={floatingStyles} onKeyDown={onKeyDown}
        onContextMenu={(event) => event.preventDefault()}>
        <button type="button" role="menuitem" className="rf-selmenu-item" onClick={annotate(last, 'highlight')}>
          <span className="rf-selmenu-swatch" data-colour={last} aria-hidden="true" />
          <span>Highlight</span><kbd aria-hidden="true">H</kbd>
        </button>
        <div className="rf-selmenu-colours" role="group" aria-label="Highlight in">
          {FIRST_COLOURS.map((c) => (
            <button key={c} type="button" role="menuitemradio" aria-checked={c === last} className="rf-seltool-dot" data-colour={c}
              aria-label={`Highlight in ${colourName(c)}`} title={colourName(c)} onClick={annotate(c, 'highlight')}>
              <span aria-hidden="true" />
            </button>
          ))}
        </div>
        <button type="button" role="menuitem" className="rf-selmenu-item" disabled={!place.prose}
          title={place.prose ? undefined : 'Underline is for running text'} onClick={annotate(last, 'underline')}>
          <span className="rf-selmenu-swatch rf-selmenu-swatch--line" data-colour={last} aria-hidden="true" />
          <span>Underline</span><kbd aria-hidden="true">U</kbd>
        </button>
        <span className="rf-selmenu-sep" role="separator" />
        {onNote && (
          <button type="button" role="menuitem" className="rf-selmenu-item" onClick={run(onNote)}>
            <span className="rf-selmenu-swatch" aria-hidden="true" /><span>Add note</span><kbd aria-hidden="true">N</kbd>
          </button>
        )}
        {steve && (
          <button type="button" role="menuitem" className="rf-selmenu-item" onClick={run(() => steve.askAbout({
            question: 'Explain this passage.', mode: 'explain_highlight', anchor: place.anchors[0], label: 'Explain this passage',
          }), { keep: true })}>
            <span className="rf-selmenu-swatch" aria-hidden="true" /><span>Ask Steve</span>
          </button>
        )}
        {onLookUp && (
          <button type="button" role="menuitem" className="rf-selmenu-item" onClick={() => { onClose(false); setTimeout(onLookUp, 0); }} /* once the closed menu lets lookup run again */>
            <span className="rf-selmenu-swatch" aria-hidden="true" /><span>Look up</span><kbd aria-hidden="true">Enter</kbd>
          </button>
        )}
        <span className="rf-selmenu-sep" role="separator" />
        <button type="button" role="menuitem" className="rf-selmenu-item" onClick={copy}>
          <span className="rf-selmenu-swatch" aria-hidden="true" /><span>Copy</span><kbd aria-hidden="true">Ctrl+C</kbd>
        </button>
      </div>
    </FloatingPortal>
  );
}
