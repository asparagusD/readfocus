# Anchors

How a highlight, underline, note, drawing, bookmark or reading position
points at a place in a book shown in the original view. This file is the
single source of truth for later chunks; numbers are policy defaults,
tunable in `backend/agents/policy.py`. Written in C16.3, before any code.

## A1. Shapes

PDF anchor, in PDF points with the origin at the **top-left** of the page
(y grows downwards; the renderer converts from PDF's bottom-left user
space once, using the page's crop box):

```json
{"kind": "pdf", "page": 12, "quads": [[x0, y0, x1, y1], ...], "text": "..."}
```

- `page`: 1-based page index in the file (not the printed folio).
- `quads`: one rectangle per line of the selection, in reading order;
  `x0 <= x1`, `y0 <= y1` (equal only for a point anchor, A3).
- `text`: the exact selected text from the page's text layer, whitespace
  collapsed. Empty only for a point anchor (A3).

EPUB anchor:

```json
{"kind": "epub", "cfi": "epubcfi(/6/14!/4/2,/1:0,/3:25)", "text": "..."}
```

- `cfi`: an EPUB CFI (EPUB Canonical Fragment Identifier 1.1). A range CFI
  for a selection; a collapsed (point) CFI for a point anchor.
- `text`: as for PDF.

Both may carry an optional `region_id` (the region map's region the
anchor starts in) and are stored as `jsonb`.

## A2. Ranges

- A range runs from **start** to **end**, both inclusive of the selected
  characters, in reading order.
- PDF: start is the top-left of the first quad's first glyph, end the
  bottom-right of the last quad's last glyph. A range may cross pages: it
  is then stored as one anchor per page, linked by the owning record, so
  every PDF anchor has exactly one `page`.
- EPUB: start and end are the range CFI's two local paths. A range stays
  inside one spine item; a selection across spine items is split the same
  way.
- A selection is normalised before saving: start before end, trailing
  whitespace dropped, `text` taken from the normalised range.

## A3. Point anchors

Bookmarks, reading positions and drawings pinned to a spot use a point:
PDF `quads: [[x, y, x, y]]` with `text: ""`; EPUB a collapsed CFI with
`text: ""`. A drawing over a figure or table also stores its `region_id`
and its own size relative to that region.

## A4. Sortable position

Every anchor gets an integer `position` computed from its start, stored
beside it, so "notes in reading order" is one `ORDER BY`:

- PDF: `page * 1e6 + floor(y0) * 1e2 + floor(99 * x0 / page_width)`,
  using the first quad. Valid while `y0 < 10 000` points (any real page).
- EPUB: `spine_index * 1e6 + order`, where `order` is the number of text
  characters in that spine document before the CFI's start, in document
  order, capped at 999 999; ties beyond the cap are broken by comparing
  the CFIs.

Positions compare only within one book.

## A5. Surviving re-pagination, font size and zoom

- PDF: quads are in page points, not screen pixels, so zoom, window size
  and device pixel ratio only change the scale they are drawn at. The
  original view never re-paginates a PDF.
- EPUB: a CFI is structural (element path and character offset), so it
  does not change when the renderer re-paginates for a new font size,
  line height or window. Highlights are re-drawn by resolving the CFI to a
  DOM range after every layout.
- Verification: after resolving, the text under the anchor is compared
  with `text`. If they differ (a re-uploaded or different file), the
  anchor is re-found by searching for `text` on the same page (PDF) or
  spine item (EPUB), then the whole book; the nearest match to the old
  position wins.
- An anchor that cannot be re-found is kept, flagged `orphaned`, and
  listed in the notepad with its text; it is never deleted silently.

## A6. Mapping to the agents' chunks and blocks

The agents read `chunks.content` by `chunk_index` (and the C12 reader used
`chunks.blocks`); anchors must map onto that.

- Ingestion (C17/C18) records each chunk's source span: PDF
  `[{page, char_start, char_end}]` in each page's text layer; EPUB
  `{spine_index, char_start, char_end}` in the spine document's text.
  These are new, additive fields; no existing column changes.
- An anchor maps to the chunk whose span contains the anchor's start
  (PDF: the character offset of `text` in the page's text layer; EPUB:
  `order` from A4). A range that crosses a chunk boundary belongs to both;
  its first chunk is its primary chunk.
- Steve's context builder, the bookmark quiz and focus scoring use this
  mapping to find "the session's text" and the questions that cover it.

C17.6 (as built): EPUB blocks map through `chunks.block_paths` (migration
017), one `{block_id, spine_index, path}` per block, `path` being the CFI
steps from the document's root to the block's element; a CFI belongs to the
deepest block whose path it starts with, else the last block of its section
before it (`frontend/src/anchors` `blockForCfi`, `book_structure.block_for_cfi`).
PDF page and character spans are not recorded yet. `books.toc` holds the
PDF outline `{title, page}` or the EPUB nav `{title, href, spine_index}`,
each with its `chunk_index` and `block_id`. The reading position is a point
a little inside the text shown (an EPUB page's first character can fall on
the page before after a re-layout).

## A7. The C12 reading positions

`reading_progress.position` holds C12's flow position
`{chunk_index, block_id, char_offset}` (migration 014). In C17 each one is
migrated to a point anchor (A3) by mapping the chunk and offset through
A6. The migration is additive (a new column or key beside the old one;
nothing dropped) and needs approval and a fresh dump under CLAUDE.md
constraint 2.

## A8. Styles

Highlights and underlines take a colour from a fixed palette of named
tokens (not free hex), so `check:contrast` can cover every colour in both
themes. Which actions a region type allows (for example no underline on a
figure) is set by the region map chunk (C18) and recorded here.

Actions by region kind (C18.5b; A9 lists the kinds):

| Kind | Highlight | Underline | Note | Drawing | Word lookup | Copy |
|---|---|---|---|---|---|---|
| prose (`block` on a PDF until C18.6) | yes | yes | yes | yes | yes | yes |
| math | yes | no | yes | yes | no | yes (LaTeX or MathML when known) |
| code | yes | no | yes | no | no | yes (exact text and indentation) |
| figure | no | no | yes | yes | no | caption only |
| table | yes (cells) | no | yes | yes | no | yes (tab-separated rows) |
| unreadable | no | no | yes | no | no | no |

## A9. Regions

The region map (C18) stores each region in `page_regions` (migrations 018,
019). `kind` is `block`, `prose`, `math`, `code`, `figure`, `table` or
`unreadable`; `order_in_page` is the reading order within a page or spine
document.

- PDF: `page` and `bbox` `[x0, top, x1, bottom]` in points from the crop
  box's top-left (A1). Math: `meta.display`, `meta.equation_number`,
  `meta.drawn` (set as outlines); a `block` carries its inline math as
  `meta.inline_math` character ranges and `inline_boxes`, drawn inline math
  as `inline_drawn` boxes. Code: rebuilt `text`, `meta.language_guess`,
  `char_width`, `line_numbers`. Figure: `meta.caption`, `label`, `labels`,
  `images`, `vectors`. Table: `meta.caption`, `label`, `rows`.
- EPUB: `page` and `bbox` null; `spine_index` and `anchor`
  `{kind: "epub", spine_index, path, cfi}`, `path` counted as
  `chunks.block_paths` counts it (A6). Math: `meta.mathml`, `latex`; prose:
  `inline_math` and `inline_code` ranges; code: `language_guess` and
  `language_source` (`class` or `guess`); figure: `caption`, `label`, `alt`,
  `images` (package paths, every rendition); table: `caption`, `label`,
  `rows`.

## A10. Highlights and underlines as built (C21)

- **Storage** (migration 026): one `annotations` row per highlight or
  underline, `anchors` an array of A1 range anchors in reading order (one
  per PDF page or EPUB spine item, A2), `position_start` and
  `position_end` (A4; the end from the bottom-right of the last quad, or
  the characters before the range's end). The reader computes the
  positions (it has the page width and the section text); the server
  checks the page or spine part and, for a PDF, the line part.
- **Styles** (A8): `color` is one of honey, sage, sky, rose, lilac (tokens
  `--hl-*` behind the text, `--ul-*` for a 2 px underline in the same hue,
  `--dot-*` in the toolbar); `style` is highlight or underline.
- **Drawing** (A5): a PDF anchor's quads are drawn at the page's scale
  between the canvas and the text layer, so zoom only rescales them; an
  EPUB CFI is resolved to a DOM range in its section and painted with the
  CSS Custom Highlight API, which follows every re-layout. Only the pages
  shown and one either side are drawn.
- **Region rules** (A8): the selection toolbar turns Underline off outside
  running text; the server does not check region kinds yet.
- **Not yet built:** checking an anchor's `text` against the page and
  re-finding moved anchors, and flagging `orphaned` (A5). An EPUB anchor
  that no longer resolves is listed but not drawn.

