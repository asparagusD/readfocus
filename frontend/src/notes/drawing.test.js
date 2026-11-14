import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base64Of, drawingScene, passageLines, passageOf } from './drawing.js';

test('a saved scene keeps live shapes only, with the one app-state key the server allows', () => {
  const scene = drawingScene([
    { id: 'a', type: 'rectangle', x: 1 },
    { id: 'b', type: 'arrow', isDeleted: true },
    { id: 'c', type: 'image', fileId: 'f' },
    { id: 'd', type: 'text', text: 'never shrinks' },
  ]);
  assert.deepEqual(scene.elements.map((e) => e.id), ['a', 'd']);
  assert.deepEqual(scene.appState, { viewBackgroundColor: '#ffffff' });
  assert.equal('files' in scene, false);
  assert.deepEqual(drawingScene(undefined).elements, []);
});

test('the passage is wrapped into short lines for a text element', () => {
  assert.equal(passageLines('the coefficients measure how much of each frequency the function contains', 24),
    'the coefficients measure\nhow much of each\nfrequency the function\ncontains');
  assert.equal(passageLines('  '), '');
  assert.equal(passageLines(undefined), '');
  assert.equal(passageOf({ anchors: [{ text: 'one' }, { text: '' }, { text: 'two' }] }), 'one two');
  assert.equal(passageOf({}), '');
});

test('a blob becomes base64', async () => {
  assert.equal(await base64Of(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])])), 'iVBORw==');
});
