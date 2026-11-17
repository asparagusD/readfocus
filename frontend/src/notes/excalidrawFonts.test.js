import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASSET_PATH, ownSources, serveOwnFonts } from './excalidrawFonts.js';

const ORIGIN = 'https://readfocus.app';

test('font sources on another origin are dropped, ours and local() kept', () => {
  const src = `url(${ORIGIN}/excalidraw-assets/fonts/Virgil/Virgil-Regular.woff2) format('woff2'), `
    + "url(https://esm.sh/@excalidraw/excalidraw@0.18.1/dist/prod/fonts/Virgil/Virgil-Regular.woff2) format('woff2')";
  assert.equal(ownSources(src, ORIGIN), `url(${ORIGIN}/excalidraw-assets/fonts/Virgil/Virgil-Regular.woff2) format('woff2')`);
  assert.equal(ownSources("local(Arial), url('/fonts/a.woff2') format('woff2'), url(\"https://cdn.example/a.woff2\")", ORIGIN),
    "local(Arial), url('/fonts/a.woff2') format('woff2')");
  assert.equal(ownSources(`url(${ORIGIN}.evil.example/a.woff2)`, ORIGIN), `url(${ORIGIN}.evil.example/a.woff2)`); // nothing left: unchanged
});

test('only another origin: left as it was (the CSP is the wall), and buffers pass through', () => {
  assert.equal(ownSources('url(https://esm.sh/a.woff2)', ORIGIN), 'url(https://esm.sh/a.woff2)');
  const buffer = new ArrayBuffer(4);
  assert.equal(ownSources(buffer, ORIGIN), buffer);
});

test('serveOwnFonts sets the asset path and wraps FontFace once', () => {
  const made = [];
  class FakeFontFace { constructor(family, src) { made.push([family, src]); } }
  const win = { FontFace: FakeFontFace, location: { origin: ORIGIN } };
  serveOwnFonts(win);
  serveOwnFonts(win);
  assert.equal(win.EXCALIDRAW_ASSET_PATH, ASSET_PATH);
  const face = new win.FontFace('Virgil', `url(${ORIGIN}/a.woff2), url(https://esm.sh/a.woff2)`);
  assert.ok(face instanceof FakeFontFace);
  assert.deepEqual(made, [['Virgil', `url(${ORIGIN}/a.woff2)`]]);
  assert.equal(Object.getPrototypeOf(win.FontFace), FakeFontFace); // wrapped once, not twice
});
