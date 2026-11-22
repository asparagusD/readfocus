import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteLanguage, regionPlace } from './fromBook.js';
import { actionsFor } from '../steve/blocks.js';

test('a code block\'s language is one the notes API knows, or none', () => {
  assert.equal(noteLanguage('python'), 'python');
  assert.equal(noteLanguage('Python'), 'python');
  assert.equal(noteLanguage('py'), 'python');
  assert.equal(noteLanguage('js'), 'javascript');
  assert.equal(noteLanguage('C++'), 'cpp');
  assert.equal(noteLanguage('shell'), 'bash');
  assert.equal(noteLanguage('brainfuck'), '');
  assert.equal(noteLanguage(null), '');
});

test('a PDF region\'s place: its box as one quad on its page with its text, or the view scope without text', () => {
  const place = regionPlace({ page: 4, bbox: [72.4, 110.26, 300, 140] }, 612, '  x = 1\n  y = 2 ');
  assert.equal(place.scope, 'selection');
  assert.deepEqual(place.anchors, [{ kind: 'pdf', page: 4, quads: [[72.4, 110.26, 300, 140]], text: 'x = 1 y = 2' }]);
  assert.equal(place.start, 4e6 + 110 * 100 + Math.floor((99 * 72.4) / 612));
  assert.equal(place.end, 4e6 + 140 * 100 + Math.floor((99 * 300) / 612));
  const bare = regionPlace({ page: 4, bbox: [72, 110, 300, 140] }, 612, '');
  assert.equal(bare.scope, 'view');
  assert.equal(bare.anchors[0].text, '');
  assert.equal(regionPlace({ page: 1, bbox: [0, 0, 1, 1] }, 612, 'y'.repeat(3000)).anchors[0].text.length, 2000);
});

test('every region kind can go to the notes, with or without Steve', () => {
  assert.deepEqual(actionsFor('math', { notes: true }), ['explain_equation', 'copy_latex', 'add_note']);
  assert.deepEqual(actionsFor('code', { notes: true, steve: false }), ['copy_code', 'add_note']);
  assert.deepEqual(actionsFor('figure', { notes: true, steve: false }), ['add_note']);
  assert.deepEqual(actionsFor('figure', { steve: false }), []); // no notes (the gallery): as before
});
