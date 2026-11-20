import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveTyped, movedStore, pageBody, typedNotes } from './moveTyped.js';

const typed = (id, words = 'Words', extra = {}) => ({ id, kind: 'text', scope: 'selection', anchors: [{ kind: 'pdf', page: 3 }],
  position_start: 3e6, position_end: 3e6 + 10, content: { words }, ...extra });

function memory() {
  const kept = new Map();
  return { getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => kept.set(k, v) };
}

function world({ failCreate = false, failRemove = false } = {}) {
  const calls = [];
  return {
    calls,
    lines: (note) => (note.content.words ? [{ text: note.content.words }] : []),
    elements: async (lines) => lines.map((l) => ({ type: 'text', text: l.text })),
    create: async (body) => { calls.push(['create', body]); if (failCreate) throw new Error('down'); return { id: `page-${calls.length}` }; },
    remove: async (id) => { calls.push(['remove', id]); if (failRemove) throw new Error('down'); },
    moved: movedStore(memory()),
  };
}

test('only saved typed notes move', () => {
  const notes = [typed('a'), typed('b', 'x', { pending: true }), typed('c', 'x', { deleted_at: 'now' }), { id: 'd', kind: 'drawing' }];
  assert.deepEqual(typedNotes(notes).map((n) => n.id), ['a']);
});

test('a page keeps the note\'s place and links and holds its words', () => {
  const body = pageBody(typed('a', 'w', { annotation_id: 'hl-1', region_id: 'rg-1', version: 4 }), [{ type: 'text' }]);
  assert.deepEqual(body, { kind: 'drawing', scope: 'selection', anchors: [{ kind: 'pdf', page: 3 }], position_start: 3e6,
    position_end: 3e6 + 10, content: { elements: [{ type: 'text' }], appState: { viewBackgroundColor: '#ffffff', paper: 'ruled' } },
    annotation_id: 'hl-1', region_id: 'rg-1' });
});

test('each note becomes a page, and only then is it deleted; an empty note is deleted alone', async () => {
  const w = world();
  const result = await moveTyped([typed('a', 'First'), typed('b', '')], w);
  assert.deepEqual(result, { moved: 1, failed: 0 });
  assert.deepEqual(w.calls.map(([what, arg]) => [what, what === 'create' ? arg.content.elements[0].text : arg]),
    [['create', 'First'], ['remove', 'a'], ['remove', 'b']]);
});

test('a page that could not be saved leaves its note, deleted nothing', async () => {
  const w = world({ failCreate: true });
  assert.deepEqual(await moveTyped([typed('a')], w), { moved: 0, failed: 1 });
  assert.deepEqual(w.calls.map(([what]) => what), ['create']);
});

test('a note whose delete failed is only deleted next time: no second page', async () => {
  const w = world({ failRemove: true });
  assert.deepEqual(await moveTyped([typed('a')], w), { moved: 0, failed: 1 });
  assert.equal(w.moved.get('a'), 'page-1');
  const again = { ...world(), moved: w.moved };
  assert.deepEqual(await moveTyped([typed('a')], again), { moved: 1, failed: 0 });
  assert.deepEqual(again.calls.map(([what]) => what), ['remove']);
  assert.equal(again.moved.get('a'), null);
});

test('the store survives a storage that throws', () => {
  const broken = { getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('no'); } };
  const store = movedStore(broken);
  store.set('a', 'p');
  assert.equal(store.get('a'), null);
});
