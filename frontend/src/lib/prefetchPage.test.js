import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prefetchCodeWhenIdle, prefetchPage } from './prefetchPage.js';

function pages() {
  const done = [];
  return {
    done,
    pages: {
      '/dashboard': { code: async () => done.push('code:dashboard'), data: ['/dashboard', '/badges'] },
      '/league': { code: async () => done.push('code:league'), data: ['/leagues/current'] },
    },
  };
}

test('pointing at a page loads its code and asks for its data', async () => {
  const { done, pages: p } = pages();
  const asked = [];
  prefetchPage('/dashboard', { pages: p, get: async (path) => asked.push(path) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(done, ['code:dashboard']);
  assert.deepEqual(asked, ['/dashboard', '/badges']);
});

test('an unknown page, a failed load or a failed request never throws', async () => {
  prefetchPage('/results/1', { pages: {}, get: async () => {} });
  const failing = { '/league': { code: () => Promise.reject(new Error('offline')), data: ['/leagues/current'] } };
  prefetchPage('/league', { pages: failing, get: () => Promise.reject(new Error('down')) });
  await new Promise((resolve) => setTimeout(resolve, 0));
});

test('when idle, every page\'s code loads, and no data is asked', async () => {
  const { done, pages: p } = pages();
  let given;
  prefetchCodeWhenIdle({ pages: p, idle: (run) => { given = run; } });
  assert.deepEqual(done, []);
  given();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(done.sort(), ['code:dashboard', 'code:league']);
});
