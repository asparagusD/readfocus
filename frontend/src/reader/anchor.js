/**
 * Places in the paginated flow (C12.3). An anchor is { block_id, char_offset }:
 * a reader block (data-b) and an offset into its text, as stored by
 * PUT /sessions/{id}/position. Pages are worked out from it again after every
 * re-pagination, so a resize, a text size or a theme change never moves the
 * reader to another passage.
 *
 * x positions are measured from the flow's own left edge, so the translate
 * that shows the current page does not change them.
 */
import { pageOfX } from './geometry.js';

function textNodes(el) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  return nodes;
}

/** The text node and offset `offset` characters into `el`'s text. */
function locate(el, offset) {
  let left = Math.max(0, offset);
  const nodes = textNodes(el);
  for (const node of nodes) {
    if (left < node.length) return { node, offset: left };
    left -= node.length;
  }
  const last = nodes[nodes.length - 1];
  return last ? { node: last, offset: Math.max(0, last.length - 1) } : null;
}

/** x of the character `offset` into `el`, from the flow's left edge, or null. */
function charX(el, offset, flowLeft) {
  const at = locate(el, offset);
  if (!at) return null;
  const range = document.createRange();
  range.setStart(at.node, at.offset);
  range.setEnd(at.node, Math.min(at.node.length, at.offset + 1));
  const rect = range.getClientRects()[0];
  return rect ? rect.left - flowLeft : null;
}

function blocks(flow) {
  return flow.querySelectorAll('[data-b]');
}

/** The first place visible on `page`: the block running into it and the first character on it. */
export function anchorForPage(flow, page, g) {
  const flowLeft = flow.getBoundingClientRect().left;
  const start = page * g.stride - 1;
  for (const el of blocks(flow)) {
    const rects = [...el.getClientRects()];
    if (!rects.some((r) => r.right - flowLeft > start)) continue;
    const id = el.dataset.b;
    if (rects[0].left - flowLeft >= start) return { block_id: id, char_offset: 0 };
    let low = 0;
    let high = el.textContent.length; // the answer is the first character whose x is on or after the page
    while (low < high) {
      const mid = (low + high) >> 1;
      const x = charX(el, mid, flowLeft);
      if (x !== null && x >= start) high = mid;
      else low = mid + 1;
    }
    return { block_id: id, char_offset: Math.min(low, Math.max(0, el.textContent.length - 1)) };
  }
  return null;
}

/** The page that shows `anchor`, or 0 when its block is not in this flow. */
export function pageForAnchor(flow, anchor, g) {
  if (!anchor?.block_id) return 0;
  const el = flow.querySelector(`[data-b="${CSS.escape(anchor.block_id)}"]`);
  if (!el) return 0;
  const flowLeft = flow.getBoundingClientRect().left;
  const x = charX(el, anchor.char_offset ?? 0, flowLeft) ?? el.getClientRects()[0]?.left - flowLeft;
  return Number.isFinite(x) ? pageOfX(x, g) : 0;
}

/** The page each element starts on (for chapter openings). */
export function pageOfElement(flow, el, g) {
  const rect = el.getClientRects()[0];
  return rect ? pageOfX(rect.left - flow.getBoundingClientRect().left, g) : 0;
}

/** The chunk index an anchor's block belongs to (block ids are "<chunk>.<n>"). */
export function chunkOfAnchor(anchor) {
  return Number.parseInt(anchor.block_id.split('.')[0], 10);
}
