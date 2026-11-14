import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerDoc, noteLanguage, quoteDoc, regionPlace } from './fromBook.js';
import { actionsFor } from '../steve/blocks.js';

/** Every node of a TipTap document, depth first. */
const nodes = (doc) => [doc, ...(doc.content ?? []).flatMap(nodes)];

test('a highlight becomes a quote of its passage, then an empty paragraph to write in', () => {
  assert.deepEqual(quoteDoc('  the lamp\nthrew  a small circle '), {
    type: 'doc',
    content: [
      { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'the lamp threw a small circle' }] }] },
      { type: 'paragraph' },
    ],
  });
  assert.deepEqual(quoteDoc(''), { type: 'doc', content: [{ type: 'paragraph' }] });
});

test('a Steve answer keeps its text, math, code, lists and citations, and says where it came from', () => {
  const text = 'He counts **twice** [p. 2] with $a_n$.\n\n$$\\sum k$$\n\n- one\n- `two`\n\n```python\nx = 1\ny = 2\n```';
  const doc = answerDoc(text, [{ label: 'p. 2', anchor: { kind: 'pdf', page: 2 } }], 'Steve · from page 2');
  const all = nodes(doc);
  assert.equal(doc.type, 'doc');
  assert.deepEqual(doc.content[0], { type: 'paragraph', content: [{ type: 'text', text: 'Steve · from page 2', marks: [{ type: 'italic' }] }] });
  assert.ok(all.some((n) => n.type === 'text' && n.text === 'twice' && n.marks?.[0].type === 'bold'));
  assert.ok(all.some((n) => n.type === 'text' && n.text.includes('[p. 2]'))); // the citation stays, as text
  assert.deepEqual(all.find((n) => n.type === 'inlineMath').attrs, { latex: 'a_n' });
  assert.deepEqual(all.find((n) => n.type === 'blockMath').attrs, { latex: '\\sum k' });
  assert.equal(all.filter((n) => n.type === 'listItem').length, 2);
  assert.ok(all.some((n) => n.type === 'text' && n.text === 'two' && n.marks?.[0].type === 'code'));
  const code = all.filter((n) => n.type === 'text' && n.marks?.some((m) => m.type === 'code')).map((n) => n.text);
  assert.ok(code.includes('x = 1') && code.includes('y = 2'));
  assert.ok(all.some((n) => n.type === 'hardBreak'));
  assert.deepEqual(doc.content.at(-1), { type: 'paragraph', content: [{ type: 'text', text: 'Sources: p. 2', marks: [{ type: 'italic' }] }] });
  // Only the server's node types: nothing the notes API would refuse.
  const allowed = new Set(['doc', 'paragraph', 'text', 'hardBreak', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'inlineMath', 'blockMath']);
  assert.ok(all.every((n) => allowed.has(n.type)), all.map((n) => n.type).join());
  assert.ok(all.every((n) => n.type !== 'text' || n.text.length > 0));
});

test('an answer without citations has no Sources line', () => {
  const doc = answerDoc('Plain.', [], 'Steve');
  assert.equal(doc.content.length, 2);
});

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
