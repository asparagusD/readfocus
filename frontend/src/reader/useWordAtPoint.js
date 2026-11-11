import { useCallback, useEffect, useRef } from 'react';
import { clearHighlight, showHighlight } from './highlight';
import { eligible, isProperNoun, phraseOf, wordAround } from './wordAt';

export const HOVER_MS = 350;
const SELECTION_SETTLE_MS = 300;

/** The text node and offset under a point: caretPositionFromPoint, else WebKit's caretRangeFromPoint. */
function caretAt(x, y) {
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    return p && { node: p.offsetNode, offset: p.offset };
  }
  const r = document.caretRangeFromPoint?.(x, y);
  return r && { node: r.startContainer, offset: r.startOffset };
}

const inside = (range, x, y) => [...range.getClientRects()]
  .some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);

/** The lookup target under (x, y) inside flow, or null: margins, gaps, spaces and skipped words give null. */
function wordTarget(flow, x, y, lang) {
  const caret = caretAt(x, y);
  const node = caret?.node;
  if (node?.nodeType !== Node.TEXT_NODE || !flow.contains(node)) return null;
  const block = node.parentElement.closest('[data-b]');
  if (!block) return null; // the "Today" note is not book text
  // A caret on the right half of a word's last letter lands just after it.
  const w = wordAround(node.data, caret.offset, lang) ?? wordAround(node.data, caret.offset - 1, lang);
  if (!w) return null;
  const range = document.createRange();
  range.setStart(node, w.start);
  range.setEnd(node, w.end);
  if (!inside(range, x, y) || !eligible(w.word, lang)) return null;
  const before = document.createRange();
  before.setStart(block, 0);
  before.setEnd(node, w.start);
  const prefix = before.toString();
  return { kind: 'word', term: w.word, proper: isProperNoun(w.word, prefix), range, key: `${block.dataset.b}:${prefix.length}` };
}

/**
 * Words and phrases to look up in the reading flow (C12.7), with no change to its DOM.
 * Hover: a mouse or pen resting on the same word for HOVER_MS. Selection: 2 to 5 words
 * selected inside the flow, by mouse or touch. Each gives onLookup({kind, term, proper, range})
 * once and marks it softly; a turn (paused), clear() or the next target removes the mark.
 */
export function useWordAtPoint(flowRef, layerRef, { onLookup, lang = 'en', paused = false }) {
  const shown = useRef(null); // key of the marked target
  const candidate = useRef(null);
  const timer = useRef(0);
  const frame = useRef(0);
  const enabled = Boolean(onLookup);
  const lookup = useRef(onLookup);
  useEffect(() => { lookup.current = onLookup; }, [onLookup]);

  const clear = useCallback(() => {
    clearTimeout(timer.current);
    candidate.current = null;
    shown.current = null;
    clearHighlight(layerRef.current);
  }, [layerRef]);

  const show = useCallback((target) => {
    shown.current = target.key;
    showHighlight(target.range, layerRef.current);
    const { kind, term, proper, range } = target;
    lookup.current?.({ kind, term, proper, range });
  }, [layerRef]);

  useEffect(() => {
    if (paused) clear();
  }, [paused, clear]);

  useEffect(() => {
    const flow = flowRef.current;
    if (!enabled || paused || !flow) return undefined;
    const settle = (x, y) => {
      const target = wordTarget(flow, x, y, lang);
      if (target?.key === candidate.current?.key) return; // still on the same word: let the timer run
      clearTimeout(timer.current);
      candidate.current = target;
      if (target && target.key !== shown.current) timer.current = setTimeout(() => show(target), HOVER_MS);
    };
    const onMove = (event) => {
      // Touch has its own gesture (selection here, long-press later); a pressed button is a selection in progress.
      if (event.pointerType === 'touch' || event.buttons) return;
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => settle(event.clientX, event.clientY));
    };
    const onLeave = () => {
      cancelAnimationFrame(frame.current);
      clearTimeout(timer.current);
      candidate.current = null;
    };
    let settleSelection = 0;
    const onSelection = () => {
      clearTimeout(settleSelection);
      settleSelection = setTimeout(() => {
        const selection = document.getSelection();
        if (!selection?.rangeCount || selection.isCollapsed) return;
        const range = selection.getRangeAt(0);
        if (!flow.contains(range.commonAncestorContainer)) return;
        const phrase = phraseOf(selection.toString(), lang);
        if (!phrase) { // one word, or more than five: no lookup, and no older mark left beside it
          if (shown.current) clear();
          return;
        }
        if (shown.current === `phrase:${phrase.term}`) return;
        clearTimeout(timer.current);
        show({ kind: 'phrase', term: phrase.term, proper: phrase.proper, range: range.cloneRange(), key: `phrase:${phrase.term}` });
      }, SELECTION_SETTLE_MS);
    };
    flow.addEventListener('pointermove', onMove);
    flow.addEventListener('pointerleave', onLeave);
    flow.addEventListener('pointerdown', onLeave); // a press starts a selection or a swipe, not a hover
    document.addEventListener('selectionchange', onSelection);
    return () => {
      onLeave();
      clearTimeout(settleSelection);
      flow.removeEventListener('pointermove', onMove);
      flow.removeEventListener('pointerleave', onLeave);
      flow.removeEventListener('pointerdown', onLeave);
      document.removeEventListener('selectionchange', onSelection);
    };
  }, [flowRef, enabled, paused, lang, show, clear]);

  return { clear };
}
