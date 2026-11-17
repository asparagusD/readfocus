import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLOURS, colourName, lastColour, newAnnotation, storeLastColour } from './palette.js';

const memory = () => {
  const items = new Map();
  return { getItem: (k) => items.get(k) ?? null, setItem: (k, v) => items.set(k, String(v)) };
};

test('the palette is the handoff five, in order, each with a name for screen readers', () => {
  assert.deepEqual(COLOURS, ['honey', 'sage', 'sky', 'rose', 'lilac']);
  assert.equal(colourName('lilac'), 'Lilac');
});

test('the last colour is remembered, and honey stands in when nothing (or nonsense) is stored', () => {
  const store = memory();
  assert.equal(lastColour(store), 'honey');
  storeLastColour('sky', store);
  assert.equal(lastColour(store), 'sky');
  store.setItem('rf-highlight-colour', 'amber');
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
