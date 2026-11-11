// WCAG 2.x contrast check for src/styles/tokens.css (C10.2).
// Usage: node scripts/check-contrast.mjs [tokens.css]   (npm run check:contrast)
// Applies the plain colour blocks in source order for each theme x accent
// pair (the file keeps them general-first), then checks every pair below.
// Exit 1 on any failure. Rules: docs/DESIGN_AUDIT.md (A1, A2, D1, D5).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const file = process.argv[2] ?? fileURLToPath(new URL('../src/styles/tokens.css', import.meta.url));
const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const blocks = [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)]
  .filter(([, sel]) => !/@theme/.test(sel))
  .map(([, sel, body]) => ({
    selectors: sel.split(',').map((s) => s.trim()).filter(Boolean),
    vars: Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/g)].map((m) => [m[1], m[2]])),
  }));

function matches(selector, attrs) {
  if (!/^(:root)?(\[[^\]]+\]|:not\(\[[^\]]+\]\))*$/.test(selector)) return false;
  for (const [, neg, key, val] of selector.matchAll(/(:not\()?\[data-(\w+)="([\w-]+)"\]/g)) {
    if ((attrs[key] === val) === Boolean(neg)) return false;
  }
  return true;
}

function resolve(attrs) {
  const out = {};
  for (const b of blocks) if (b.selectors.some((s) => matches(s, attrs))) Object.assign(out, b.vars);
  return out;
}

const channel = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const grounds = ['--paper', '--paper-2', '--surface', '--page'];
const washes = ['--accent-soft', '--warn-soft'];
const rules = [
  // Text, 4.5:1 on every ground and wash.
  ...['--ink', '--ink-2', '--accent-text', '--accent', '--warn'].flatMap((fg) =>
    [...grounds, ...washes].map((bg) => [fg, bg, 4.5, 'text'])),
  // A2: --ink-3 only on the plain grounds.
  ...grounds.map((bg) => ['--ink-3', bg, 4.5, 'caption']),
  // D1: text on accent fills, resting and hovered.
  ['--accent-ink', '--accent', 4.5, 'text on accent'],
  ['--accent-ink', '--accent-hover', 4.5, 'text on accent hover'],
  // A1 and A10: boundaries and the focus ring, 3:1 (WCAG 1.4.11).
  ...['--line-field', '--accent'].flatMap((fg) => grounds.map((bg) => [fg, bg, 3, 'boundary'])),
  // Toast fill: ground colour on ink.
  ['--paper', '--ink', 4.5, 'inverse text'],
  // D5: cream title on each cover.
  ...['--cover-moss', '--cover-oxblood', '--cover-ink', '--cover-ochre', '--cover-slate'].map((bg) => ['--cover-title', bg, 4.5, 'cover']),
];

let failures = 0;
let checked = 0;
for (const theme of ['paper', 'lamplight']) {
  for (const accent of ['terracotta', 'sage']) {
    const t = resolve({ theme, accent });
    for (const [fg, bg, min, kind] of rules) {
      if (!t[fg] || !t[bg]) {
        console.log(`MISSING ${theme}/${accent}: ${fg} or ${bg}`);
        failures++;
        continue;
      }
      const r = ratio(t[fg], t[bg]);
      checked++;
      if (r < min) {
        console.log(`FAIL ${theme}/${accent} ${kind}: ${fg} ${t[fg]} on ${bg} ${t[bg]} = ${r.toFixed(2)} (needs ${min})`);
        failures++;
      }
    }
  }
}
console.log(`${checked} pairs checked across 4 theme x accent combinations, ${failures} failing`);
process.exit(failures ? 1 : 0);
