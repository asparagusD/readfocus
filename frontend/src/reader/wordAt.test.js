import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eligible, isProperNoun, lookupPath, phraseOf, sentenceInitial, wordAround } from './wordAt.js';

const TEXT = 'I went to the woods because I wished to live deliberately, said Thoreau.';

test('wordAround finds the whole word under an offset, at any letter', () => {
  const start = TEXT.indexOf('woods');
  for (const at of [start, start + 2, start + 4]) {
    assert.deepEqual(wordAround(TEXT, at, 'en'), { word: 'woods', start, end: start + 5 });
  }
});

test('wordAround gives nothing between words or on punctuation', () => {
  assert.equal(wordAround(TEXT, TEXT.indexOf(' woods'), 'en'), null);
  assert.equal(wordAround(TEXT, TEXT.length - 1, 'en'), null);
});

test('wordAround keeps apostrophes and hyphens inside a word', () => {
  assert.equal(wordAround("the pond's edge", 6, 'en').word, "pond's");
  assert.equal(wordAround('a well-known road', 4, 'en').word, 'well-known');
  assert.equal(wordAround('the pond’s edge', 6, 'en').word, 'pond’s');
});

test('eligible skips stopwords, short words, numbers and punctuation', () => {
  for (const word of ['the', 'Because', 'which', 'to', 'I', '1854', '3rd', '—', '...']) {
    assert.equal(eligible(word, 'en'), false, word);
  }
  for (const word of ['woods', 'deliberately', 'Thoreau', 'well-known', 'pond’s']) {
    assert.equal(eligible(word, 'en'), true, word);
  }
});

test('sentenceInitial looks back past spaces, quotes and brackets', () => {
  assert.equal(sentenceInitial(''), true);
  assert.equal(sentenceInitial('It ended.  '), true);
  assert.equal(sentenceInitial('He asked? “'), true);
  assert.equal(sentenceInitial('Notes: ('), true);
  assert.equal(sentenceInitial('I went to the '), false);
  assert.equal(sentenceInitial('the shore, '), false);
});

test('isProperNoun: capitalised and not at the start of a sentence', () => {
  const at = (word) => TEXT.slice(0, TEXT.indexOf(word));
  assert.equal(isProperNoun('Thoreau', at('Thoreau')), true);
  assert.equal(isProperNoun('woods', at('woods')), false);
  assert.equal(isProperNoun('Walden', ''), false); // sentence-initial: could be any word
  assert.equal(isProperNoun('Walden', 'he left. '), false);
  assert.equal(isProperNoun('Walden', 'he lived at '), true);
});

test('phraseOf accepts 2 to 5 words and trims edge punctuation', () => {
  assert.deepEqual(phraseOf('  Walden Pond, ', 'en'), { term: 'Walden Pond', words: 2, proper: true });
  assert.deepEqual(phraseOf('“the mass of men”', 'en'), { term: 'the mass of men', words: 4, proper: false });
  assert.deepEqual(phraseOf('lives of\nquiet desperation.', 'en'), { term: 'lives of quiet desperation', words: 4, proper: false });
  assert.equal(phraseOf('Walden', 'en'), null);
  assert.equal(phraseOf('I went to the woods because I', 'en'), null);
  assert.equal(phraseOf('— ...', 'en'), null);
  assert.equal(phraseOf('', 'en'), null);
});

test('phraseOf counts words, not spaces, and keeps the 60-character cap', () => {
  assert.equal(phraseOf('Henry   David Thoreau', 'en').term, 'Henry David Thoreau');
  assert.equal(phraseOf('incomprehensibilities incomprehensibilities incomprehensibilities', 'en'), null);
});

test('lookupPath asks the backend, with proper=1 only for a name', () => {
  assert.equal(lookupPath({ term: 'woods', proper: false }), '/lookup?term=woods&lang=en');
  assert.equal(lookupPath({ term: 'Walden Pond', proper: true }), '/lookup?term=Walden+Pond&lang=en&proper=1');
});
