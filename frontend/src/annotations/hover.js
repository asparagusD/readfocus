// Finding a drawn annotation (C21.4): under a point (hover, tap) and the next one on the page (the A key). Pure.

const SLACK_PX = 2; // a pointer on a highlight's very edge still counts

/** The id of the annotation whose rects hold (x, y), the latest drawn first (it is on top); null if none. */
export function annotationAt(entries, x, y) {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const { id, rects } = entries[i];
    if (rects.some((r) => x >= r.left - SLACK_PX && x <= r.right + SLACK_PX && y >= r.top - SLACK_PX && y <= r.bottom + SLACK_PX)) return id;
  }
  return null;
}

/** The id after (`dir` 1) or before (-1) `current` in `ids`, wrapping; the first when `current` is not there. */
export function cycle(ids, current, dir) {
  if (!ids.length) return null;
  const at = ids.indexOf(current);
  if (at < 0) return ids[0];
  return ids[(at + dir + ids.length) % ids.length];
}
