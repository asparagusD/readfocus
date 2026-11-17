import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useWordAtPoint } from '../reader/useWordAtPoint';
import { useWordCard } from '../reader/useWordCard';
import { WordCard } from '../reader/WordCard';
import { PhraseChip } from '../reader/PhraseChip';
import { cardContent } from '../reader/lookup';

/**
 * Word lookup in the original view (C17.5; C12.7-C12.9 moved off the block reader): hover,
 * a 2-5 word selection, a touch long-press or the Look up chip, in every `surface` the book
 * is drawn in (the PDF's text layers, each EPUB section's iframe). The card and chip are
 * placed in this page beside the word, below it or above, so they never cover its line.
 * A new `page` closes them; `paused` (a turn, the closing page) stops lookup. `ref` gets
 * { lookUpSelection, clear } for Enter, ? and Escape from the frame's keys.
 */
export function BookLookup({ surfaces, client, hover = true, paused = false, page, returnFocusTo, ref }) {
  const clearMark = useRef(() => {});
  const { card, open, close, cardRef } = useWordCard({ client, returnFocusTo, onClosed: () => clearMark.current() });
  const [chip, setChip] = useState(null); // { target, page }
  const onTarget = useCallback((target) => open(target, target.by), [open]);
  const onChip = useCallback((target) => setChip(target && { target, page }), [page]);
  const lookup = useWordAtPoint(surfaces, null, { onLookup: onTarget, onChip, paused, hover });
  useEffect(() => { clearMark.current = lookup.clearMark; }, [lookup.clearMark]);
  const { clear } = lookup;
  useEffect(() => {
    clear();
    close();
  }, [page, clear, close]);
  useImperativeHandle(ref, () => ({ lookUpSelection: lookup.lookUpSelection, clear: () => { lookup.clear(); close(); } }), [lookup, close]);

  const announce = card ? cardContent(card.state, card.target).announce : '';
  return (
    <>
      <p className="rf-ov-said" aria-live="polite" aria-atomic="true">{announce}</p>
      {card && <WordCard card={card} cardRef={cardRef} onClose={close} />}
      {chip?.page === page && !paused && !card && (
        <PhraseChip target={chip.target} onLookUp={() => { lookup.lookUp(chip.target, 'chip'); setChip(null); }} />
      )}
    </>
  );
}
