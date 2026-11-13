# Decisions

Choices that shape the code, with the evidence behind them. Newest first.

## D-C17.3 EPUB engine: foliate-js or epub.js (2026-11-12, accepted)

Status: **accepted** (your OK, 2026-11-12: "Yes, foliate-js"). Vendored at
`78914aef4466` in `frontend/src/vendor/foliate-js/`; the spike passed
(C17.3 row in `docs/PROGRESS.md`): every packaged image shown, MathML,
fixed layout and the hostile book as expected.

What the original view needs (C17 plan, ANCHORS A1-A5): every image kept,
reflowable books paged into our frame (a spread at 1024 px and wider, one
page below), fixed-layout books page by page, EPUB CFIs for highlights and
positions, the section documents in reach for selection, highlights and
word lookup, small and lazy, and safe with untrusted books.

Evidence was gathered on 2026-11-12 from the npm registry, the GitHub API,
and the source of foliate-js at commit `78914aef4466` and of `epubjs@0.3.93`
(the newest release). I read the source but did not run either engine on a
book; C17.3b's first step is that check.

| | foliate-js | epub.js (`epubjs`) |
|---|---|---|
| Licence | MIT (`LICENSE` at the commit). Its `vendor/zip.js` is zip.js (BSD-3-Clause) | BSD-2-Clause (`license` in the package). It needs JSZip (MIT or GPL-3.0, used under MIT) |
| Maintenance | One maintainer. 15 commits in the last 12 months, the last on 2026-05-01. No npm release by the author: the README says to vendor it and calls the API "not stable". The npm package named `foliate-js` was published by someone else | Last npm release 0.3.93 in 2023. 3 commits in the last 12 months, the last on 2026-03-24. 518 open issues |
| Size, minified + gzip -9 | 37.2 KB for a reflowable EPUB: `view.js` with CFI, progress and overlayer 8.2, the EPUB parser 8.1, paginator 7.1, zip 13.8. Fixed layout adds 2.4 KB. Bundled with rolldown | `epub.min.js` 63.6 KB plus JSZip 28.3 KB = 91.9 KB. The bundle carries core-js polyfills, lodash and localforage |
| Pagination | One section per iframe, paged with CSS columns (`paginator.js`). The margin, gap, column width and `max-column-count` are attributes on the element | CSS columns in iframes; "default" and "continuous" managers |
| Spreads | `max-column-count` gives two columns at our width and one on narrow screens (`--_max-column-count-portrait`) | `spread: 'auto'` with `minSpreadWidth` (default 800 px) |
| EPUB CFI | `epubcfi.js`: parse, compare, range to and from CFI, and a node filter so nodes we inject do not shift CFIs | `EpubCFI` class, mature, the same use |
| Fixed layout | `fixed-layout.js`: `rendition:layout pre-paginated`, `rendition:spread`, `page-spread-left/right`, zoom `fit-page` / `fit-width` / number | Recognised (`layout.js`, `rendition.js`). Spread and placement are the older code path |
| Images, SVG, figures | Loaded **per section, on demand**, as `blob:` URLs, reference-counted and revoked when a section unloads. It rewrites `src`, `srcset`, `poster`, `object[data]`, `xlink:href`, `<link href>`, CSS `url()` in `<style>`, `style=""` and stylesheets. **Gaps**: SVG 2 `<image href>` (plain `href`, not `xlink:href`) is not rewritten. External URLs (`http:`) are left as they are | Every manifest resource is unpacked and replaced **up front for the whole book** when it opens: blob URLs for a zipped EPUB (`book.js`: `this.archived ? "blobUrl" : "base64"`). URLs are swapped by string substitution, so any attribute is covered, at the cost of holding every image of an image-heavy book in memory |
| Image fit | `setImageSize()`: every `img`, `svg` and `video` gets max height and width for the page, `object-fit: contain` and `break-inside: avoid` | Only what the publisher's CSS says; no built-in fit |
| MathML | Sections are blobs of type `application/xhtml+xml`, so the browser renders MathML natively | `srcdoc` by default, parsed as HTML; MathML still renders natively in current browsers |
| Section documents | A `load` event gives `{ doc, index }`; `getContents()` lists `{ doc, index, overlayer }`; `transformTarget` lets us change each document before it renders; `overlayer.js` draws SVG highlights | `rendition.hooks.content` and `getContents()` give `Contents` with `.document`; highlights come from marks-pane |
| Scripts | Not supported. The README says a CSP blocking scripts is required | Off by default (`allowScriptedContent: false`); same-origin iframes, so the same CSP need |

### Recommendation: foliate-js

- **It keeps images with less memory.** Images load per section and are
  revoked when the section unloads, close to "pages ±2" in the C17.3
  prompt. epub.js unpacks every image of the book into a blob when it opens.
- **It fits images to the page out of the box** (max size, `object-fit`,
  `break-inside: avoid`). That is most of the C17.3 image rule; the
  rest is our CSS (figure and figcaption kept together, explicit sizes).
- **Fixed layout, spreads and CFIs are first-class**, and the overlayer
  already draws highlights for C20 (C19 until the C19 renumbering).
- **It is less than half the size**: 37–40 KB gzip against 92 KB.
- **It is maintained**, more actively than epub.js, though by one person.

Costs and how C17.3 handles them:

1. *Unstable API, no release.* Vendor it at commit `78914aef4466` under
   `frontend/src/vendor/foliate-js/` (only the modules above, with
   `LICENSE`, and a README naming the commit). Call it from one adapter,
   `originalview/epub/engine.js`. Updating it is a deliberate change.
2. *SVG 2 `<image href>` is not rewritten.* Our `transformTarget` step
   resolves those against the package (so no image is lost). A unit test
   on a fixture with both `href` and `xlink:href` covers it.
3. *External URLs are left alone.* The sanitizer removes `http(s):` and
   protocol-relative references (img, CSS `url()`, `srcset`, links to
   stylesheets), and the app-wide CSP added in C17.3 stops anything
   missed.
4. *Scripts.* The sanitizer (DOMPurify in `transformTarget`) removes
   scripts, event handlers, `<iframe>`, `<object>`, `<embed>`, `<form>`
   and `javascript:` URLs; the CSP backs it up.

If the first spike shows foliate-js failing on the test EPUBs
(images missing, CFIs not round-tripping, fixed layout broken), I stop
and come back here before switching to epub.js.
