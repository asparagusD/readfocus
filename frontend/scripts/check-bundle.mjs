// Bundle budgets (C25.2): `npm run check:bundle` after `npm run build`; exit 1 on any failure.
//
// Reads .bundle-stats.json, written by the build (vite.config.js, bundleStats). The initial route is the entry chunk
// and every chunk it imports statically: what a first visit downloads before any lazy page. Its gzipped JavaScript
// must stay within INITIAL_JS_GZIP_BUDGET. The heavy libraries of phase 2 must each be bundled (so the check is not
// vacuous) and only in chunks loaded on demand, never in the initial route.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const ROOT = join(import.meta.dirname, '..');
const STATS = join(ROOT, '.bundle-stats.json');
const DIST = join(ROOT, 'dist');

// Measured at C25.2 (see docs/BENCHMARKS.md) plus about 10%: raise it on purpose, in a commit that says why.
export const INITIAL_JS_GZIP_BUDGET = 200_000; // 180.4 KB at C25.2
export const LAZY_PACKAGES = ['pdfjs-dist', 'foliate-js (vendored)', '@excalidraw/excalidraw', 'tesseract.js']; // TipTap left with typed notes (C37.4)

const kb = (n) => `${(n / 1000).toFixed(1)} KB`;

/** The entry chunk and everything it imports statically, by file name. */
export function initialFiles(chunks) {
  const byFile = new Map(chunks.map((c) => [c.file, c]));
  const entry = chunks.filter((c) => c.isEntry);
  if (entry.length !== 1) throw new Error(`expected one entry chunk, found ${entry.length}`);
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const next of byFile.get(file)?.imports ?? []) visit(next);
  };
  visit(entry[0].file);
  return seen;
}

/** Failures for these chunks and gzipped sizes ({file: bytes}); empty when every rule holds. */
export function failures(chunks, gzipOf, budget = INITIAL_JS_GZIP_BUDGET) {
  const errors = [];
  const initial = initialFiles(chunks);
  const total = [...initial].reduce((sum, file) => sum + gzipOf[file], 0);
  if (total > budget) errors.push(`initial route JS is ${kb(total)} gzipped, over the ${kb(budget)} budget`);
  for (const name of LAZY_PACKAGES) {
    const holding = chunks.filter((c) => c.packages.includes(name));
    if (!holding.length) errors.push(`${name} is in no chunk: the check would pass without looking (update LAZY_PACKAGES)`);
    for (const c of holding.filter((c) => initial.has(c.file))) errors.push(`${name} is in ${c.file}, part of the initial route`);
  }
  return errors;
}

function main() {
  if (!existsSync(STATS)) {
    console.error('check:bundle: no .bundle-stats.json; run `npm run build` first');
    return 1;
  }
  const { chunks } = JSON.parse(readFileSync(STATS, 'utf8'));
  const gzipOf = Object.fromEntries(chunks.map((c) => [c.file, gzipSync(readFileSync(join(DIST, c.file))).length]));
  const initial = initialFiles(chunks);
  const total = [...initial].reduce((sum, file) => sum + gzipOf[file], 0);
  console.log(`Initial route (${initial.size} JS files): ${kb(total)} gzipped, budget ${kb(INITIAL_JS_GZIP_BUDGET)}`);
  for (const file of [...initial].sort((a, b) => gzipOf[b] - gzipOf[a])) console.log(`  ${kb(gzipOf[file]).padStart(9)}  ${file}`);
  for (const name of LAZY_PACKAGES) {
    const holding = chunks.filter((c) => c.packages.includes(name));
    const size = holding.reduce((sum, c) => sum + gzipOf[c.file], 0);
    console.log(`Lazy: ${name} in ${holding.length} chunk(s), ${kb(size)} gzipped together`);
  }
  const errors = failures(chunks, gzipOf);
  errors.forEach((line) => console.error(`FAIL ${line}`));
  console.log(`${chunks.length} JS chunks checked, ${errors.length} failing`);
  return errors.length ? 1 : 0;
}

if (import.meta.url === `file:///${process.argv[1].replaceAll('\\', '/').replace(/^\//, '')}`) process.exitCode = main();
