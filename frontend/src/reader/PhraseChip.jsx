import { useCallback, useLayoutEffect } from 'react';
import { autoUpdate, flip, FloatingPortal, inline, offset, shift, useFloating } from '@floating-ui/react';
import './WordCard.css';

/**
 * The "Look up" chip (C12.9, handoff "word card · mobile"): a small pill by a 2-5 word selection
 * made by touch. It sits below the selection, where the platform's own selection menu is not
 * (that one opens above), and flips above at the page foot. A tap opens the compact sheet.
 */
export function PhraseChip({ target, onLookUp }) {
  const { refs, floatingStyles } = useFloating({
    placement: 'bottom',
    strategy: 'fixed',
    transform: false,
    middleware: [inline(), offset(10), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const setFloating = useCallback((el) => refs.setFloating(el), [refs]);
  const { range } = target;
  useLayoutEffect(() => {
    refs.setPositionReference({
      getBoundingClientRect: () => range.getBoundingClientRect(),
      getClientRects: () => range.getClientRects(),
      contextElement: range.startContainer.parentElement ?? undefined,
    });
  }, [refs, range]);
  return (
    <FloatingPortal>
      <button
        type="button"
        ref={setFloating}
        className="rf-lookchip"
        style={floatingStyles}
        // Keep the selection: a press on the chip must not collapse it before the tap lands.
        onPointerDown={(event) => event.preventDefault()}
        onClick={onLookUp}
        aria-label={`Look up “${target.term}”`}
      >
        Look up
      </button>
    </FloatingPortal>
  );
}
