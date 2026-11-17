import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_STUDIO_KEYS_URL, canSend, cleanKey, saveError, savedKeyLabel } from './ownKey.js';

const KEY = 'AIzaSyReaderOwnKey-not-real-abcdefghij12';

test('a pasted key loses the spaces and line breaks copying adds', () => {
  assert.equal(cleanKey(`  ${KEY}\n`), KEY);
  assert.equal(cleanKey(`AIzaSy Reader\tOwnKey`), 'AIzaSyReaderOwnKey');
  assert.equal(cleanKey(undefined), '');
});

test('only a key-shaped value is sent', () => {
  assert.equal(canSend(KEY), true);
  assert.equal(canSend(` ${KEY} `), true);
  for (const value of ['', 'short', 'not a key at all, with spaces and commas!!', `${KEY}?`, 'x'.repeat(101)]) {
    assert.equal(canSend(value), false, value);
  }
});

test('a saved key is named by its last four characters only', () => {
  assert.equal(savedKeyLabel('ij12'), 'Key ending in ij12');
  assert.equal(savedKeyLabel(null), 'No key saved');
});

test('a refusal shows the server\'s words, anything else a plain fallback', () => {
  assert.equal(saveError(new Error('Google did not accept this key.')), 'Google did not accept this key.');
  assert.equal(saveError(new Error('API request failed')), 'The key could not be saved. Try again in a minute.');
  assert.equal(saveError(undefined), 'The key could not be saved. Try again in a minute.');
});

test('the link goes to Google AI Studio\'s key page', () => {
  assert.equal(AI_STUDIO_KEYS_URL, 'https://aistudio.google.com/apikey');
});
