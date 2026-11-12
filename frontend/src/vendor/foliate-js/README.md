# foliate-js (vendored)

EPUB engine for the original view (C17.3; decision D-C17.3 in
`docs/DECISIONS.md`).

- Source: https://github.com/johnfactotum/foliate-js
- Commit: `78914aef4466eb960965702401634c2cb348e9b1` (2026-05-01)
- Licence: MIT (`LICENSE`). `vendor/zip.js` is zip.js by Gildas Lormeau,
  BSD-3-Clause (`vendor/LICENSE-zip.js`, fetched from the zip.js
  repository because foliate-js ships the build without it).

Copied unchanged: `view.js`, `epub.js`, `epubcfi.js`, `paginator.js`,
`fixed-layout.js`, `overlayer.js`, `progress.js`, `text-walker.js`,
`search.js`, `vendor/zip.js`.

ReadFocus stubs, not foliate-js code: `comic-book.js`, `fb2.js`, `pdf.js`,
`mobi.js`, `tts.js`, `vendor/fflate.js`. `view.js` imports them only for
formats ReadFocus does not open; each throws if it is ever loaded.

Only `frontend/src/originalview/epub/engine.js` imports this folder.
To update: fetch the same files at a new commit, record it here, and
re-run the EPUB checks (C17.3 in `docs/PROGRESS.md`). ESLint skips this
folder.
