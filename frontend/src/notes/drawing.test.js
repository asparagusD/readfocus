import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base64Of, drawingScene, newPageContent, pagePaper, paperView, passageLines, passageOf } from './drawing.js';

test('a saved scene keeps live shapes and pictures, the app state the server allows, and uploaded files', () => {
  const scene = drawingScene([
    { id: 'a', type: 'rectangle', x: 1 },
    { id: 'b', type: 'arrow', isDeleted: true },
    { id: 'c', type: 'image', fileId: 'f' },
    { id: 'd', type: 'text', text: 'never shrinks' },
  ]);
  assert.deepEqual(scene.elements.map((e) => e.id), ['a', 'c', 'd']); // C37.6: pictures stay
  assert.deepEqual(scene.appState, { viewBackgroundColor: '#ffffff' });
  assert.equal('files' in scene, false);
  const files = { f: { path: 'u/b/1.webp', mimeType: 'image/webp' } };
  assert.deepEqual(drawingScene([], null, files).files, files);
  assert.equal('files' in drawingScene([], null, {}), false);
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

test('a page keeps its paper; a new page is ruled, an older drawing plain', () => {
  assert.deepEqual(drawingScene([], 'squared').appState, { viewBackgroundColor: '#ffffff', paper: 'squared' });
  assert.deepEqual(newPageContent(), { elements: [], appState: { viewBackgroundColor: '#ffffff', paper: 'ruled' } });
  assert.equal(pagePaper(newPageContent()), 'ruled');
  assert.equal(pagePaper({ elements: [], appState: { viewBackgroundColor: '#ffffff' } }), 'plain');
  assert.equal(pagePaper({ appState: { paper: 'lined' } }), 'plain');
  assert.equal(pagePaper(undefined), 'plain');
});

test('the paper follows Excalidraw\'s scroll and zoom', () => {
  assert.deepEqual(paperView({ scrollX: 0, scrollY: 0, zoom: { value: 1 } }), { step: '32px', x: '0px', y: '0px', margin: '40px' });
  assert.deepEqual(paperView({ scrollX: -10, scrollY: 50, zoom: { value: 2 } }), { step: '64px', x: '44px', y: '36px', margin: '60px' });
  assert.equal(paperView({ zoom: { value: Number.NaN } }).step, '32px'); // never NaN, which would wipe the lines
  assert.deepEqual(paperView(), { step: '32px', x: '0px', y: '0px', margin: '40px' });
});
