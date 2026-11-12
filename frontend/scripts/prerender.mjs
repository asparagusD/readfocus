// Puts the prerendered landing page into dist/index.html (C13.10e); run by `npm run build`
// after the client build and the SSR build of src/prerender.jsx (into dist-ssr/).
// The markup goes inside #root in a [data-prerendered] wrapper. index.html's inline script
// hides that wrapper on any path but "/" and for a visitor with a stored session, so only a
// signed-out visitor at "/" ever sees it; createRoot then replaces it with the live app.
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const page = join(root, 'dist', 'index.html');
const ssr = join(root, 'dist-ssr');
const { render } = await import(pathToFileURL(join(ssr, 'prerender.js')).href);

const html = readFileSync(page, 'utf8');
const slot = '<div id="root"></div>';
if (!html.includes(slot)) throw new Error('prerender: no empty #root in dist/index.html');
writeFileSync(page, html.replace(slot, `<div id="root"><div data-prerendered>${render()}</div></div>`));
rmSync(ssr, { recursive: true, force: true });
console.log(`prerender: landing page written into dist/index.html (${(readFileSync(page).length / 1000).toFixed(1)} KB)`);
