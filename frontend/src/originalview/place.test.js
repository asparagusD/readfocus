import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compare, folioShort, placeEnd, placeStart, squeeze } from './place.js';

const pdf = (pages) => ({ kind: 'pdf', pages });
const epub = (index, charStart, charEnd) => ({ kind: 'epub', index, charStart, charEnd });

test('text is compared without case or whitespace', () => {
  assert.equal(squeeze('  The Lamp\n threw\ta  circle '), 'thelampthrewacircle');
  assert.equal(squeeze(null), '');
});

test('locations order by page, or by section then character', () => {
  assert.ok(compare({ kind: 'pdf', page: 3 }, { kind: 'pdf', page: 5 }) < 0);
  assert.ok(compare({ kind: 'epub', index: 2, char: 900 }, { kind: 'epub', index: 3, char: 0 }) < 0);
  assert.ok(compare({ kind: 'epub', index: 3, char: 40 }, { kind: 'epub', index: 3, char: 10 }) > 0);
});

test('a place starts at its first page or character and ends at its last', () => {
  assert.deepEqual(placeStart(pdf([4, 5])), { kind: 'pdf', page: 4 });
  assert.deepEqual(placeEnd(pdf([4, 5])), { kind: 'pdf', page: 5 });
  assert.deepEqual(placeStart(epub(2, 300, 900)), { kind: 'epub', index: 2, char: 300 });
  assert.deepEqual(placeEnd(epub(2, 300, 900)), { kind: 'epub', index: 2, char: 900 });
});

test("the ribbon's toast names the pages without the total", () => {
  assert.equal(folioShort('p. 5 of 6'), 'p. 5');
  assert.equal(folioShort('pp. 4–5 of 6'), 'pp. 4–5');
});
