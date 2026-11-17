import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beyond, chunkAt, compare, folioShort, reached, shows, snippetsFor, squeeze } from './today.js';

const pdf = (pages) => ({ kind: 'pdf', pages });
const epub = (index, charStart, charEnd) => ({ kind: 'epub', index, charStart, charEnd });

test('text is compared without case or whitespace, by its first 40 then 20 characters', () => {
  assert.equal(squeeze('  The Lamp\n threw\ta  circle '), 'thelampthrewacircle');
  const text = 'Line 1 of page 3: the lamp threw a small circle of light.';
  assert.deepEqual(snippetsFor(text), ['line1ofpage3:thelampthrewasmallcircleofl', 'line1ofpage3:thelamp']);
  assert.deepEqual(snippetsFor('Too short'), []);
});

test('locations order by page, or by section then character', () => {
  assert.ok(compare({ kind: 'pdf', page: 3 }, { kind: 'pdf', page: 5 }) < 0);
  assert.ok(compare({ kind: 'epub', index: 2, char: 900 }, { kind: 'epub', index: 3, char: 0 }) < 0);
  assert.ok(compare({ kind: 'epub', index: 3, char: 40 }, { kind: 'epub', index: 3, char: 10 }) > 0);
});

test("today's end is reached when the pages shown hold it or lie past it", () => {
  const end = { kind: 'pdf', page: 5 };
  assert.equal(reached(pdf([3, 4]), end), false);
  assert.equal(reached(pdf([4, 5]), end), true);
  assert.equal(reached(pdf([6]), end), true);
  assert.equal(shows(pdf([6]), end), false);
  const at = { kind: 'epub', index: 2, char: 500 };
  assert.equal(reached(epub(2, 0, 499), at), false);
  assert.equal(shows(epub(2, 300, 900), at), true);
  assert.equal(reached(epub(1, 0, 900), at), false);
  assert.equal(reached(epub(2, 0, 900), null), false);
});

test('pages wholly outside the start and end are beyond today', () => {
  const bounds = { start: { kind: 'pdf', page: 3 }, end: { kind: 'pdf', page: 5 } };
  assert.equal(beyond(pdf([1, 2]), bounds), true);
  assert.equal(beyond(pdf([2, 3]), bounds), false);
  assert.equal(beyond(pdf([5]), bounds), false);
  assert.equal(beyond(pdf([6, 7]), bounds), true);
  assert.equal(beyond(pdf([9]), { start: bounds.start, end: null }), false); // no end found: never beyond it
});

test('the chunk shown is the last located start at or before the pages', () => {
  const starts = [{ chunk_index: 4, loc: { kind: 'pdf', page: 3 } }, { chunk_index: 5, loc: { kind: 'pdf', page: 4 } }];
  assert.equal(chunkAt(pdf([3]), starts), 4);
  assert.equal(chunkAt(pdf([4, 5]), starts), 5);
  assert.equal(chunkAt(pdf([1]), starts), 4); // before today: today's first chunk
  assert.equal(chunkAt(pdf([1]), []), null);
});

test("the ribbon's toast names the pages without the total", () => {
  assert.equal(folioShort('p. 5 of 6'), 'p. 5');
  assert.equal(folioShort('pp. 4–5 of 6'), 'pp. 4–5');
});
