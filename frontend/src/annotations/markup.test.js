import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toggleTool, toolStatus, toolsFor } from './markup.js';

test('a PDF and an EPUB both offer the highlighter', () => {
  assert.deepEqual(toolsFor('pdf').map((t) => t.id), ['highlight']);
  assert.deepEqual(toolsFor('epub').map((t) => t.id), ['highlight']);
});

test('a press turns a tool on, a second press on it turns it off, another press switches', () => {
  assert.equal(toggleTool(null, 'highlight'), 'highlight');
  assert.equal(toggleTool('highlight', 'highlight'), null);
  assert.equal(toggleTool('draw', 'highlight'), 'highlight');
});

test('the reader is told what the tool does and how to stop it', () => {
  assert.equal(toolStatus('highlight', { colour: 'ocean' }),
    'Highlighter on, Ocean. Select text to highlight it. Escape turns it off.');
  assert.equal(toolStatus(null), 'Markup tools off.');
});
