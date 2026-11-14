/**
 * Margin markers for notes (C22.4, handoff screen 19): where each note's passage is on the pages shown, grouped
 * into one marker per line and laid out so no two overlap. Pure: the renderers measure, this decides.
 */

/** A note's first PDF anchor on one of the pages shown, or null. */
export function shownAnchor(note, pages) {
  return note.anchors?.find((a) => a.kind === 'pdf' && pages.includes(a.page)) ?? null;
}

/** The screen top of a PDF anchor's first quad (a view note's quad starts at the page's top-left). */
export const pdfNoteTop = (anchor, pageTop, scale) => pageTop + (anchor.quads?.[0]?.[1] ?? 0) * scale;

export const markerLabel = (n) => `${n} ${n === 1 ? 'note' : 'notes'} on this passage`;

/**
 * Spots ({ id, side, x, top }, in the markers' box) become markers ({ ids, side, x, top }): spots on one side
 * within `tolerance` px of a marker's line join it; then, top to bottom on each side, a marker is moved down past
 * the one above (`size` + `gap`) and past any obstacle it overlaps ({ side, top, bottom, left?, right? }, such as
 * the ribbon's tail).
 */
export function layoutMarkers(spots, { tolerance = 16, size = 26, gap = 4, obstacles = [] } = {}) {
  const sorted = [...spots].sort((a, b) => a.top - b.top);
  const markers = [];
  for (const spot of sorted) {
    const line = markers.find((m) => m.side === spot.side && Math.abs(m.x - spot.x) < 1 && spot.top - m.top <= tolerance);
    if (line) line.ids.push(spot.id);
    else markers.push({ ids: [spot.id], side: spot.side, x: spot.x, top: spot.top });
  }
  const below = {};
  for (const marker of markers) {
    let top = Math.max(marker.top, below[marker.side] ?? -Infinity);
    for (const o of obstacles) {
      const across = o.left === undefined || (marker.x < o.right && marker.x + size > o.left);
      if (o.side === marker.side && across && top < o.bottom && top + size > o.top) top = o.bottom + gap;
    }
    marker.top = top;
    below[marker.side] = top + size + gap;
  }
  return markers.sort((a, b) => (a.side === b.side ? a.top - b.top : a.side === 'left' ? -1 : 1));
}
