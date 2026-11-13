"""Tables, figures and math drawn as outlines on a PDF page (C18.5a). Pure functions.

Input is an extract.Page (lines, graphics, table candidates) and the page's
upright lines not yet claimed; output is plain dicts {kind, lines, bbox,
text, meta} that classify.py turns into regions, the ids of the lines they
claim, and boxes of math drawn inside text lines.

- Tables: pdfplumber's candidates with at least TABLE_MIN_ROWS x
  TABLE_MIN_COLUMNS cells, enough of them with text; their lines are claimed
  and a "Table N" caption above or below is attached.
- Drawing objects (images, rects, curves, lines) outside tables cluster by
  proximity. Shaded frames around text are left out (they decorate text).
  A cluster of glyph-sized objects is text drawn as outlines (Calculus sets
  its math this way): inline in a text line it is recorded on that line,
  standing apart it is display math with meta.drawn. Otherwise a cluster
  with an image, or a large area with little text, is a figure, taking the
  text inside it as labels and a "Figure N" caption.
Thresholds: backend/regions/policy.py.
"""

import re
from statistics import median

from backend.regions import policy

CAPTION = re.compile(policy.CAPTION_PATTERN)


def _center_in(line, box) -> bool:
    cx, cy = (line.x0 + line.x1) / 2, (line.top + line.bottom) / 2
    return box[0] <= cx <= box[2] and box[1] <= cy <= box[3]


def _union(boxes) -> list[float]:
    return [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)]


def _line_box(line) -> list[float]:
    return [line.x0, line.top, line.x1, line.bottom]


def _touch(a, b, gap) -> bool:
    return a[0] - gap <= b[2] and b[0] - gap <= a[2] and a[1] - gap <= b[3] and b[1] - gap <= a[3]


def _caption(box, lines, claimed, blocks, size, prefixes) -> tuple[list, str | None, str | None]:
    """The caption lines nearest the box (above or below), with the caption text and its label."""
    best = None
    for line in lines:
        if id(line) in claimed:
            continue
        found = CAPTION.match(line.text.strip())
        if not found or not found.group(1).lower().startswith(prefixes):
            continue
        overlap = min(line.x1, box[2]) > max(line.x0, box[0])
        gap = max(line.top - box[3], box[1] - line.bottom)
        if overlap and gap <= policy.CAPTION_GAP_EM * size and (best is None or gap < best[0]):
            best = (gap, line, found.group(1))
    if best is None:
        return [], None, None
    _, first, label = best
    block = next((b for b in blocks if any(n is first for n in b.lines)), None)
    caption = [first]
    if block is not None:  # the caption paragraph: its block from the caption line down
        start = next(i for i, n in enumerate(block.lines) if n is first)
        caption = [n for n in block.lines[start:] if id(n) not in claimed]
    return caption, " ".join(n.text for n in caption), label


def _tables(page, lines, claimed, size) -> list[dict]:
    found = []
    for candidate in page.tables:
        rows = [[(cell or "").replace("\n", " ").strip() for cell in row] for row in candidate["rows"]]
        columns = max((len(r) for r in rows), default=0)
        cells = [cell for row in rows for cell in row]
        filled = sum(1 for cell in cells if cell) / max(1, len(cells))
        if len(rows) < policy.TABLE_MIN_ROWS or columns < policy.TABLE_MIN_COLUMNS or filled < policy.TABLE_MIN_FILLED:
            continue
        box = list(candidate["bbox"])
        inside = [n for n in lines if id(n) not in claimed and _center_in(n, box)]
        claimed.update(id(n) for n in inside)
        caption, text, label = _caption(box, lines, claimed, page.blocks, size, ("table",))
        claimed.update(id(n) for n in caption)
        meta = {"rows": rows, "caption": text, "label": label}
        found.append({"kind": "table", "lines": inside + caption, "bbox": _union([box] + [_line_box(n) for n in caption]),
                      "text": "\n".join("\t".join(row) for row in rows), "meta": meta})
    return found


def _clusters(objects, gap) -> list[list]:
    clusters: list[list] = []  # [box, members]
    for obj in sorted(objects, key=lambda o: (o.bbox[1], o.bbox[0])):
        touching = [c for c in clusters if _touch(c[0], obj.bbox, gap)]
        merged = [obj] + [m for c in touching for m in c[1]]
        clusters = [c for c in clusters if not any(c is t for t in touching)]
        clusters.append([_union([m.bbox for m in merged]), merged])
    return clusters


def _text_share(box, lines) -> float:
    area = max(1.0, (box[2] - box[0]) * (box[3] - box[1]))
    inside = [n for n in lines if _center_in(n, box)]
    return sum((n.x1 - n.x0) * (n.bottom - n.top) for n in inside) / area


def find(page, lines) -> dict:
    """{"regions": [...], "claimed": {id(line)}, "inline_drawn": {id(line): [box, ...]}}."""
    size = median(n.size for n in lines) if lines else 10.0
    claimed: set[int] = set()
    regions = _tables(page, lines, claimed, size)
    table_boxes = [r["bbox"] for r in regions]
    objects = []
    for g in page.graphics:
        box = g.bbox
        middle = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2, (box[0] + box[2]) / 2, (box[1] + box[3]) / 2]
        if any(_touch(t, middle, 0) for t in table_boxes):
            continue  # a table's own rules and corners
        if g.kind == "rect" and sum(1 for n in lines if _center_in(n, box)) >= policy.FRAME_MIN_LINES:
            continue  # a shaded frame around text
        objects.append(g)
    inline: dict[int, list] = {}
    glyph = policy.DRAWN_GLYPH_MAX_EM * size
    for box, members in _clusters(objects, policy.FIGURE_CLUSTER_GAP_EM * size):
        images = [m for m in members if m.kind == "image"]
        glyphs = [m for m in members if m.kind != "image" and max(m.bbox[2] - m.bbox[0], m.bbox[3] - m.bbox[1]) <= glyph]
        width, height = box[2] - box[0], box[3] - box[1]
        if not images and len(glyphs) >= policy.DRAWN_GLYPH_SHARE * len(members):
            row = next((n for n in lines if id(n) not in claimed and min(n.bottom, box[3]) - max(n.top, box[1])
                        >= policy.DRAWN_INLINE_OVERLAP * (n.bottom - n.top)), None)
            if row is not None:
                inline.setdefault(id(row), []).append([round(v, 2) for v in box])
            elif len(members) >= policy.DRAWN_MIN_OBJECTS:
                inside = [n for n in lines if id(n) not in claimed and _center_in(n, box)]
                claimed.update(id(n) for n in inside)
                regions.append({"kind": "math", "lines": inside, "bbox": [round(v, 2) for v in box],
                                "text": "\n".join(n.text for n in inside),
                                "meta": {"display": True, "drawn": True, "clues": ["drawn"]}})
            continue
        big_image = any(min(m.bbox[2] - m.bbox[0], m.bbox[3] - m.bbox[1]) >= policy.FIGURE_MIN_IMAGE_SIDE_EM * size
                        for m in images)
        drawing = (len(members) - len(images) >= policy.FIGURE_MIN_VECTOR_OBJECTS
                   and width * height >= policy.FIGURE_MIN_AREA_EM2 * size * size
                   and min(width, height) >= policy.FIGURE_MIN_SIDE_EM * size
                   and _text_share(box, lines) <= policy.FIGURE_MAX_TEXT_SHARE)
        if not (big_image or drawing):
            continue  # a rule, an icon, a decoration
        labels = [n for n in lines if id(n) not in claimed and _center_in(n, box)]
        claimed.update(id(n) for n in labels)
        caption, text, label = _caption(box, lines, claimed, page.blocks, size, ("fig", "figure"))
        claimed.update(id(n) for n in caption)
        labels.sort(key=lambda n: (n.top, n.x0))
        regions.append({"kind": "figure", "lines": labels + caption,
                        "bbox": [round(v, 2) for v in _union([box] + [_line_box(n) for n in caption])],
                        "text": text or "", "meta": {"caption": text, "label": label, "labels": [n.text for n in labels],
                                                     "images": len(images), "vectors": len(members) - len(images)}})
    return {"regions": regions, "claimed": claimed, "inline_drawn": inline}


def columns(lines, width) -> float | None:
    """The x of a clean two-column gutter, or None for a one-column page."""
    if len(lines) < 2 * policy.COLUMN_MIN_LINES:
        return None
    best = None
    for step in range(int(width * 0.25), int(width * 0.75), 2):
        left = sum(1 for n in lines if n.x1 < step)
        right = sum(1 for n in lines if n.x0 > step)
        crossing = len(lines) - left - right
        if min(left, right) >= max(policy.COLUMN_MIN_LINES, policy.COLUMN_MIN_SHARE * len(lines)) \
                and crossing <= max(policy.COLUMN_MIN_CROSSING, policy.COLUMN_MAX_CROSSING * len(lines)) and (best is None or crossing < best[0]):
            best = (crossing, step)
    return float(best[1]) if best else None


def reading_order(regions, split: float | None) -> list:
    """Regions in reading order: top to bottom, or column by column between full-width regions."""
    if split is None:
        return sorted(regions, key=lambda r: (r.bbox[1], r.bbox[0]))
    spanning = sorted(r.bbox[1] for r in regions if r.bbox[0] < split < r.bbox[2])

    def key(region):
        band = sum(1 for top in spanning if top <= region.bbox[1])
        if region.bbox[0] < split < region.bbox[2]:
            return (band, -1, region.bbox[1], region.bbox[0])
        return (band, 0 if region.bbox[2] <= split else 1, region.bbox[1], region.bbox[0])

    return sorted(regions, key=key)
