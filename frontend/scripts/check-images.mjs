// Image budgets (C11.5): `npm run check:images`, exit 1 on any failure.
//
//   1. Each raster under src/ and public/ is at most 150 KB (150,000 bytes).
//   2. All of them together, everything an initial route could load, at
//      most 400 KB. (Book covers are loaded at runtime: rule 5 caps each,
//      and Lighthouse measures a real route, docs/BENCHMARKS.md.)
//   3. Each illustration SVG (src/illustrations/svg) is at most 8 KB.
//   4. Every <img> in src/**/*.jsx has width, height, decoding and loading;
//      it is lazy, unless it is the LCP image: then loading is eager and
//      fetchPriority is high (an expression must switch both together).
//   5. The backend's cover download cap (covers.MAX_IMAGE_BYTES) is within
//      rule 1, so no cover we store breaks the budget.
//
// `node scripts/check-images.mjs [root]`: root defaults to the repo, so the
// rules can be tried on a scratch tree.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RASTER_MAX = 150_000;
const ROUTE_MAX = 400_000;
const SVG_MAX = 8_000;
const RASTER = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif']);

const repo = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const frontend = join(repo, 'frontend');
const failures = [];
const kb = (n) => `${(n / 1000).toFixed(1)} KB`;

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = [...walk(join(frontend, 'src')), ...walk(join(frontend, 'public'))];
const rel = (p) => relative(repo, p).replaceAll('\\', '/');

// 1 and 2: rasters.
let rasterTotal = 0;
for (const file of files.filter((f) => RASTER.has(extname(f).toLowerCase()))) {
  const size = statSync(file).size;
  rasterTotal += size;
  if (size > RASTER_MAX) failures.push(`${rel(file)}: ${kb(size)} > ${kb(RASTER_MAX)} per raster`);
}
if (rasterTotal > ROUTE_MAX) failures.push(`rasters together: ${kb(rasterTotal)} > ${kb(ROUTE_MAX)} for an initial route`);

// 3: illustrations.
const svgs = files.filter((f) => rel(f).startsWith('frontend/src/illustrations/svg/') && f.endsWith('.svg'));
for (const file of svgs) {
  const size = statSync(file).size;
  if (size > SVG_MAX) failures.push(`${rel(file)}: ${kb(size)} > ${kb(SVG_MAX)} per illustration`);
}

// 4: <img> attributes.
let images = 0;
for (const file of files.filter((f) => f.endsWith('.jsx'))) {
  const text = readFileSync(file, 'utf8');
  // JSX <img> is self-closing; end at "/>" so an arrow (=>) inside a prop does not cut the tag.
  for (const match of text.matchAll(/<img\b[\s\S]*?\/>/g)) {
    images += 1;
    const tag = match[0];
    const line = text.slice(0, match.index).split('\n').length;
    const where = `${rel(file)}:${line}`;
    const attr = (name) => tag.match(new RegExp(`\\b${name}=(\\{[^}]*\\}|"[^"]*")`))?.[1];
    for (const name of ['width', 'height', 'decoding', 'loading']) {
      if (!attr(name)) failures.push(`${where}: <img> without ${name}`);
    }
    const loading = attr('loading') ?? '';
    const priority = attr('fetchPriority') ?? '';
    if (loading.includes('eager') && !priority.includes('high')) {
      failures.push(`${where}: an eager (LCP) image needs fetchPriority="high"`);
    }
    if (priority.includes('high') && !loading.includes('eager')) {
      failures.push(`${where}: fetchPriority="high" on a lazy image`);
    }
    if (loading && !loading.includes('lazy') && !loading.includes('eager')) {
      failures.push(`${where}: loading must be lazy, or eager for the LCP image`);
    }
  }
}

// 5: the cover download cap.
const coversPy = join(repo, 'backend', 'services', 'covers.py');
const cap = existsSync(coversPy) && readFileSync(coversPy, 'utf8').match(/^MAX_IMAGE_BYTES\s*=\s*([\d_]+)/m);
if (!cap) failures.push('backend/services/covers.py: MAX_IMAGE_BYTES not found');
else if (Number(cap[1].replaceAll('_', '')) > RASTER_MAX) {
  failures.push(`backend/services/covers.py: MAX_IMAGE_BYTES ${cap[1]} > ${RASTER_MAX}`);
}

console.log(`${files.filter((f) => RASTER.has(extname(f).toLowerCase())).length} rasters (${kb(rasterTotal)} together), `
  + `${svgs.length} illustrations, ${images} <img> tags checked, ${failures.length} failing`);
for (const failure of failures) console.log(`  FAIL ${failure}`);
process.exit(failures.length ? 1 : 0);
