import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COLOURS, colourName, coloursUsed, FIRST_COLOURS, lastColour, MARK_COLOURS, MORE_COLOURS, newAnnotation, storeLastColour,
} from './palette.js';

const memory = () => {
  const items = new Map();
  return { getItem: (k) => items.get(k) ?? null, setItem: (k, v) => items.set(k, String(v)) };
};

test("the palette is the handoff five, then Edge's red and deeper shades, each with a name for screen readers", () => {
  assert.deepEqual(FIRST_COLOURS, ['honey', 'sage', 'sky', 'rose', 'lilac']);
  assert.deepEqual(MORE_COLOURS, ['poppy', 'amber', 'fern', 'ocean', 'berry']);
  assert.deepEqual(COLOURS, [...FIRST_COLOURS, ...MORE_COLOURS]);
  assert.deepEqual(MARK_COLOURS, ['ink', 'poppy', 'amber', 'fern', 'ocean', 'berry', 'plum']);
  assert.equal(colourName('lilac'), 'Lilac');
});

test('the colours a book uses are listed in palette order, once each', () => {
  const used = coloursUsed([{ color: 'berry' }, { color: 'honey' }, { color: 'berry' }, { color: 'sky' }]);
  assert.deepEqual(used, ['honey', 'sky', 'berry']);
  assert.deepEqual(coloursUsed([]), []);
});

test('the last colour is remembered, and honey stands in when nothing (or nonsense) is stored', () => {
  const store = memory();
  assert.equal(lastColour(store), 'honey');
  storeLastColour('sky', store);
  assert.equal(lastColour(store), 'sky');
  storeLastColour('ocean', store); // C39.2: a deeper colour is remembered too
  assert.equal(lastColour(store), 'ocean');
  store.setItem('rf-highlight-colour', 'mauve');
  assert.equal(lastColour(store), 'honey');
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(lastColour(broken), 'honey');
  assert.doesNotThrow(() => storeLastColour('rose', broken));
});

test('a selection becomes the body the API takes', () => {
  const place = { anchors: [{ kind: 'epub', cfi: 'epubcfi(/6/4!/4,/1:0,/1:5)', text: 'Hello' }], start: 1_000_000, end: 1_000_005 };
  assert.deepEqual(newAnnotation(place, 'sage', 'underline'), {
    anchors: place.anchors, style: 'underline', color: 'sage', position_start: 1_000_000, position_end: 1_000_005,
  });
});
