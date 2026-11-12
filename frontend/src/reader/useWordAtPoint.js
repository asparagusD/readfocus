import { useCallback, useEffect, useRef } from 'react';
import { clearHighlight, showHighlight } from './highlight';
import { createLongPress } from './longPress';
import { eligible, isProperNoun, phraseOf, wordAround, words } from './wordAt';

export const HOVER_MS = 350;
const SELECTION_SETTLE_MS = 300;

/** Text that is not looked up (C17.5): math, code and figures, whatever the book's markup. */
export const SKIP = 'math, code, pre, kbd, samp, figure, svg, [data-no-lookup]';
/** The element a word's sentence is read from, to tell a proper noun from a sentence's first word. */
const BLOCK = 'p, li, dd, dt, blockquote, h1, h2, h3, h4, h5, h6, td, th, .textLayer';

/** The text node and offset under a point in doc: caretPositionFromPoint, else WebKit's caretRangeFromPoint. */
function caretAt(doc, x, y) {
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y);
    return p && { node: p.offsetNode, offset: p.offset };
  }
  const r = doc.caretRangeFromPoint?.(x, y);
  return r && { node: r.startContainer, offset: r.startOffset };
}

const inside = (range, x, y) => [...range.getClientRects()]
  .some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);

/** The block's text before (node, offset): enough to tell whether a capital starts a sentence. */
function textBefore(block, node, offset) {
  const before = node.ownerDocument.createRange();
  before.setStart(block, 0);
  before.setEnd(node, offset);
  return before.toString();
}

const ids = new WeakMap();
let nextId = 1;
const keyOf = (el) => {
  if (!ids.has(el)) ids.set(el, nextId++);
  return ids.get(el);
};

/** Where a text node's word belongs: its block inside root, or null for text that is never looked up. */
function blockOf(root, node) {
  const parent = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  if (!parent || parent.closest(SKIP)) return null;
  const block = parent.closest(BLOCK);
  return block && root.contains(block) ? block : root;
}

/** The current selection inside a surface as a target: one word or a 2-5 word phrase; null otherwise. */
function selectionTarget({ root, doc }, lang, single) {
  const selection = doc.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const start = range.startContainer;
  const block = blockOf(root, start);
  if (!block) return null;
  const text = selection.toString();
  const phrase = phraseOf(text, lang);
  if (phrase) return { kind: 'phrase', term: phrase.term, proper: phrase.proper, range: range.cloneRange(), key: `phrase:${phrase.term}` };
  const found = words(text, lang);
  if (!single || found.length !== 1) return null;
  const term = found[0].word;
  const proper = isProperNoun(term, textBefore(block, start, range.startOffset) + text.slice(0, found[0].start));
  return { kind: 'word', term, proper, range: range.cloneRange(), key: `word:${term}` };
}

/** The lookup target under (x, y) in a surface's own coordinates, or null: margins, spaces, skipped words and math, code or figures give null. */
function wordTarget({ root, doc }, x, y, lang) {
  const caret = caretAt(doc, x, y);
  const node = caret?.node;
  if (node?.nodeType !== Node.TEXT_NODE || !root.contains(node)) return null;
  const block = blockOf(root, node);
  if (!block) return null;
  // A caret on the right half of a word's last letter lands just after it.
  const w = wordAround(node.data, caret.offset, lang) ?? wordAround(node.data, caret.offset - 1, lang);
  if (!w) return null;
  const range = doc.createRange();
  range.setStart(node, w.start);
  range.setEnd(node, w.end);
  if (!inside(range, x, y) || !eligible(w.word, lang)) return null;
  const prefix = textBefore(block, node, w.start);
  return { kind: 'word', term: w.word, proper: isProperNoun(w.word, prefix), range, key: `${keyOf(block)}:${prefix.length}` };
}

/**
 * Words and phrases to look up in a book (C12.7; any number of documents since C17.5), with
 * no change to its DOM. `surfaces` are { root, doc }: the PDF's text layers in this page, or
 * each EPUB section's body in its own iframe. Hover: a mouse or pen resting on the same word
 * for HOVER_MS. Selection: 2 to 5 words selected, by mouse or touch. Each gives
 * onLookup({kind, term, proper, range}) once and marks it softly; a turn (paused), clear() or
 * the next target removes the mark. Math, code and figures are never looked up.
 */
export function useWordAtPoint(surfaces, layerRef, { onLookup, onChip, lang = 'en', paused = false, hover = true }) {
  const shown = useRef(null); // key of the marked target
  const candidate = useRef(null);
  const timer = useRef(0);
  const frame = useRef(0);
  const enabled = Boolean(onLookup);
  const lookup = useRef(onLookup);
  useEffect(() => { lookup.current = onLookup; }, [onLookup]);
  const chip = useRef(onChip);
  useEffect(() => { chip.current = onChip; }, [onChip]);

  /** Remove the mark only: a hover already under way on another word goes on (C12.8). */
  const clearMark = useCallback(() => {
    shown.current = null;
    clearHighlight(layerRef?.current);
  }, [layerRef]);

  const clear = useCallback(() => {
    clearTimeout(timer.current);
    candidate.current = null;
    clearMark();
  }, [clearMark]);

  // by: 'hover', 'select' (a selection settled), 'key' (Enter or ? on a selection), 'press' (touch
  // long-press) or 'chip' (the Look up chip on a touch selection).
  const show = useCallback((target, by) => {
    shown.current = target.key;
    showHighlight(target.range, layerRef?.current);
    const { kind, term, proper, range } = target;
    lookup.current?.({ kind, term, proper, range, by });
  }, [layerRef]);

  /** Enter or ? (C12.8): look up the selected word or phrase now; false when nothing fits. */
  const lookUpSelection = useCallback(() => {
    if (!enabled || paused) return false;
    for (const surface of surfaces) {
      const target = selectionTarget(surface, lang, true);
      if (target) {
        show(target, 'key');
        return true;
      }
    }
    return false;
  }, [surfaces, enabled, paused, lang, show]);

  useEffect(() => {
    if (paused) clear();
  }, [paused, clear]);

  useEffect(() => {
    if (!enabled || paused || !surfaces.length) return undefined;
    const detach = surfaces.map((surface) => attach(surface));
    return () => detach.forEach((off) => off());

    function attach(surface) {
      const { root, doc } = surface;
      const settle = (x, y) => {
        const target = wordTarget(surface, x, y, lang);
        if (target?.key === candidate.current?.key) return; // still on the same word: let the timer run
        clearTimeout(timer.current);
        candidate.current = target;
        if (target && target.key !== shown.current) timer.current = setTimeout(() => show(target, 'hover'), HOVER_MS);
      };
      const onMove = (event) => {
        // Touch has its own gestures (long-press, selection); a pressed button is a selection in progress.
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
          const selection = doc.getSelection();
          if (!selection?.rangeCount || selection.isCollapsed) return chip.current?.(null);
          if (!root.contains(selection.getRangeAt(0).commonAncestorContainer)) return undefined; // another surface's
          const target = selectionTarget(surface, lang, false);
          if (!target) { // one word, or more than five: no lookup, and no older phrase mark left beside it
            chip.current?.(null);
            if (shown.current?.startsWith('phrase:')) clearMark();
            return undefined;
          }
          // On touch the OS menu sits on the selection: offer a chip instead of opening a card unasked (C12.9).
          if (lastPointer === 'touch' && chip.current) return chip.current(target);
          if (shown.current === target.key) return undefined;
          clearTimeout(timer.current);
          return show(target, 'select');
        }, SELECTION_SETTLE_MS);
      };
      // Touch long-press (C12.9): the card for the word held, with no page turn and no OS menu for it.
      let lastPointer = 'mouse';
      let swallowClick = false;
      const holdAt = (x, y) => {
        const target = wordTarget(surface, x, y, lang);
        if (!target) return false; // a space, a short or common word: the platform's own selection goes on
        clearTimeout(timer.current);
        show(target, 'press');
        return true;
      };
      let heldWord = false;
      const press = createLongPress({ onHold: ({ x, y }) => { heldWord = holdAt(x, y); } });
      const onDown = (event) => {
        lastPointer = event.pointerType;
        heldWord = false;
        press.down({ x: event.clientX, y: event.clientY, pointerType: event.pointerType });
      };
      const onTouchMove = (event) => { if (event.pointerType === 'touch') press.move({ x: event.clientX, y: event.clientY }); };
      const onUp = () => { if (press.up() && heldWord) swallowClick = true; };
      const onCancel = () => press.cancel(); // the browser took the gesture: a scroll or a swipe
      const onContextMenu = (event) => {
        if (event.pointerType !== 'touch' && lastPointer !== 'touch') return; // a mouse's own menu stays
        // The platform's long-press (Android) can come before our timer: it counts as the hold.
        if (!press.held && holdAt(event.clientX, event.clientY)) heldWord = true;
        if (heldWord) event.preventDefault();
      };
      const onClick = (event) => {
        if (!swallowClick) return;
        swallowClick = false;
        event.preventDefault();
        event.stopPropagation();
      };
      root.addEventListener('pointerdown', onDown);
      root.addEventListener('pointermove', onTouchMove);
      root.addEventListener('pointerup', onUp);
      root.addEventListener('pointercancel', onCancel);
      root.addEventListener('contextmenu', onContextMenu);
      root.addEventListener('click', onClick, true);
      if (hover) { // the reader can turn hover off (toolbar); selection and Enter still work
        root.addEventListener('pointermove', onMove);
        root.addEventListener('pointerleave', onLeave);
        root.addEventListener('pointerdown', onLeave); // a press starts a selection or a swipe, not a hover
      }
      doc.addEventListener('selectionchange', onSelection);
      return () => {
        onLeave();
        clearTimeout(settleSelection);
        root.removeEventListener('pointermove', onMove);
        root.removeEventListener('pointerleave', onLeave);
        root.removeEventListener('pointerdown', onLeave);
        doc.removeEventListener('selectionchange', onSelection);
        press.cancel();
        root.removeEventListener('pointerdown', onDown);
        root.removeEventListener('pointermove', onTouchMove);
        root.removeEventListener('pointerup', onUp);
        root.removeEventListener('pointercancel', onCancel);
        root.removeEventListener('contextmenu', onContextMenu);
        root.removeEventListener('click', onClick, true);
      };
    }
  }, [surfaces, enabled, paused, hover, lang, show, clearMark]);

  return { clear, clearMark, lookUpSelection, lookUp: show };
}
