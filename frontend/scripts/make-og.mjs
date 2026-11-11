// The 1200 x 630 share image (C13.10e): `node scripts/make-og.mjs` writes public/og.png.
//
// The card is laid out in HTML with the app's own tokens, bundled fonts and original
// illustrations, rendered by the installed Microsoft Edge through Playwright (no browser
// download), then encoded by sharp as a palette PNG under the 150 KB image budget.
// Run it again after changing the wordmark, the tokens or the drawings; the PNG is committed.

import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'og.png');
const MAX_BYTES = 150_000;
const url = (path) => pathToFileURL(join(root, path)).href;
const svg = (name) => readFileSync(join(root, 'src/illustrations/svg', `${name}.svg`), 'utf8');
const font = (pkg, file) => url(`node_modules/@fontsource-variable/${pkg}/files/${file}.woff2`);

const html = `<!doctype html>
<html lang="en" data-theme="paper" data-accent="terracotta">
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="${url('src/styles/tokens.css')}">
<link rel="stylesheet" href="${url('src/illustrations/illustrations.css')}">
<style>
  @font-face { font-family: "Playfair Display Variable"; src: url(${font('playfair-display', 'playfair-display-latin-wght-normal')}); font-weight: 400 900; }
  @font-face { font-family: "Lora Variable"; src: url(${font('lora', 'lora-latin-wght-normal')}); font-weight: 400 700; }
  @font-face { font-family: "DM Sans Variable"; src: url(${font('dm-sans', 'dm-sans-latin-wght-normal')}); font-weight: 100 1000; }
  html, body { margin: 0; }
  body { width: 1200px; height: 630px; background: var(--paper); color: var(--ink); overflow: hidden; }
  .card { position: absolute; inset: 28px; border: 1px solid var(--line-2); border-radius: 4px;
          display: grid; grid-template-columns: 640px 1fr; align-items: center; padding: 0 0 0 72px; }
  .mark { display: flex; align-items: center; gap: 12px; margin: 0 0 40px; font: 500 34px/1 "Playfair Display Variable", Georgia, serif; }
  .mark svg { width: 36px; height: 36px; stroke: var(--accent-text); fill: none; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }
  h1 { margin: 0 0 28px; font: 500 76px/1.02 "Playfair Display Variable", Georgia, serif; letter-spacing: -0.01em; }
  p { margin: 0; max-width: 30em; color: var(--ink-2); font: 400 25px/1.5 "Lora Variable", Georgia, serif; }
  .scene { position: relative; height: 100%; }
  .scene .rf-illustration { position: absolute; }
  /* One sill line; the window stands behind it, the lamp and the open book on it. */
  /* Each drawing has a margin inside its viewBox (about 6% at the foot): offset to stand on the sill. */
  .window { --illustration-size: 240px; left: -10px; bottom: 136px; }
  .lamp { --illustration-size: 210px; right: -16px; bottom: 138px; }
  .book { --illustration-size: 190px; left: 118px; bottom: 132px; }
  .sill { position: absolute; left: 0; right: 40px; bottom: 150px; border-top: 1.6px solid var(--ink-2); }
</style>
</head>
<body>
  <div class="card">
    <div>
      <div class="mark"><svg viewBox="0 0 24 24"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg>ReadFocus</div>
      <h1>Read deeply,<br>remember more.</h1>
      <p>Focused reading sessions that feel like a real book, with words explained right where you read them.</p>
    </div>
    <div class="scene">
      <span class="rf-illustration window">${svg('DuskWindow')}</span>
      <span class="rf-illustration lamp">${svg('ReadingLamp')}</span>
      <span class="sill"></span>
      <span class="rf-illustration book">${svg('OpenBook')}</span>
    </div>
  </div>
</body>
</html>`;

const page = join(tmpdir(), `readfocus-og-${process.pid}.html`);
writeFileSync(page, html);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const tab = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await tab.goto(pathToFileURL(page).href);
  await tab.evaluate(() => document.fonts.ready);
  const shot = await tab.screenshot({ type: 'png' });
  await sharp(shot).png({ palette: true, colours: 96, dither: 0.6, compressionLevel: 9, effort: 10 }).toFile(out);
} finally {
  await browser.close();
}
const bytes = statSync(out).size;
console.log(`public/og.png: 1200 x 630, ${(bytes / 1000).toFixed(1)} KB`);
if (bytes > MAX_BYTES) {
  console.error(`over the ${MAX_BYTES / 1000} KB budget`);
  process.exit(1);
}
