// The bundle check's rules (C25.2, scripts/check-bundle.mjs), on made-up chunks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failures, initialFiles, LAZY_PACKAGES } from '../../scripts/check-bundle.mjs';

const chunk = (file, over = {}) => ({ file, isEntry: false, isDynamicEntry: false, imports: [], dynamicImports: [], packages: [], ...over });
const lazyHolders = () => LAZY_PACKAGES.map((name, i) => chunk(`lazy-${i}.js`, { isDynamicEntry: true, packages: [name] }));
const sizes = (chunks, each = 1000) => Object.fromEntries(chunks.map((c) => [c.file, each]));

test('the initial route is the entry and what it imports statically, never what it imports on demand', () => {
  const chunks = [chunk('index.js', { isEntry: true, imports: ['vendor.js'], dynamicImports: ['reader.js'] }),
    chunk('vendor.js', { imports: ['react.js'] }), chunk('react.js'), chunk('reader.js', { isDynamicEntry: true })];
  assert.deepEqual([...initialFiles(chunks)].sort(), ['index.js', 'react.js', 'vendor.js']);
});

test('lazy libraries only in chunks loaded on demand, within budget: no failures', () => {
  const chunks = [chunk('index.js', { isEntry: true, dynamicImports: ['lazy-0.js'] }), ...lazyHolders()];
  assert.deepEqual(failures(chunks, sizes(chunks)), []);
});

test('a heavy library pulled into the initial route fails, and so does one missing from every chunk', () => {
  const holders = lazyHolders();
  holders[0].packages = [];
  const chunks = [chunk('index.js', { isEntry: true, imports: ['shared.js'] }),
    chunk('shared.js', { packages: ['@tiptap/core'] }), ...holders];
  const found = failures(chunks, sizes(chunks));
  assert.ok(found.some((line) => line.startsWith('@tiptap/core is in shared.js, part of the initial route')));
  assert.ok(found.some((line) => line.startsWith(`${LAZY_PACKAGES[0]} is in no chunk`)));
});

test('the initial route over its gzip budget fails', () => {
  const chunks = [chunk('index.js', { isEntry: true, imports: ['vendor.js'] }), chunk('vendor.js'), ...lazyHolders()];
  assert.deepEqual(failures(chunks, sizes(chunks, 600), 1000), ['initial route JS is 1.2 KB gzipped, over the 1.0 KB budget']);
});
