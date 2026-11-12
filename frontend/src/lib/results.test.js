// node --test (npm run test:unit): the results page's pure helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conceptChips, outcome, splitFeedback, summary, verdict } from './results.js';

test('feedback splits into its sentence and the quoted passage', () => {
  assert.deepEqual(
    splitFeedback('You missed opportunity cost. See the passage: “the cost of a thing is the amount of life”'),
    { text: 'You missed opportunity cost. See the passage:', quote: 'the cost of a thing is the amount of life' },
  );
  assert.deepEqual(splitFeedback('Correct: the answer is cabin.'), { text: 'Correct: the answer is cabin.', quote: '' });
  assert.deepEqual(splitFeedback(undefined), { text: '', quote: '' });
});

test('outcomes by share of the points, and low confidence apart', () => {
  assert.equal(outcome({ score: 8, max_score: 10 }), 'right');
  assert.equal(outcome({ score: 5, max_score: 10 }), 'partial');
  assert.equal(outcome({ score: 3, max_score: 10 }), 'wrong');
  assert.equal(outcome({ score: 10, max_score: 10, confidence: 'low' }), 'unsure');
  assert.equal(outcome({ score: 0, max_score: 0 }), 'wrong');
});

test('the summary counts each outcome and skips zeros', () => {
  const grades = [{ score: 10, max_score: 10 }, { score: 9, max_score: 10 }, { score: 6, max_score: 10 }, { score: 1, max_score: 10 }];
  assert.equal(summary(grades), '2 correct · 1 partial · 1 to revisit');
  assert.equal(summary([{ score: 4, max_score: 10, confidence: 'low' }]), '1 not judged');
});

test('a concept missed anywhere is to revisit, even if matched elsewhere', () => {
  const chips = conceptChips([
    { matched_concepts: ['economy', 'simplicity'], missing_concepts: [] },
    { matched_concepts: ['simplicity'], missing_concepts: ['economy', 'opportunity cost'] },
    {},
  ]);
  assert.deepEqual(chips, { strengthened: ['simplicity'], revisit: ['economy', 'opportunity cost'] });
});

test('the verdict follows the percentage bands', () => {
  assert.match(verdict(86), /^A strong session/);
  assert.match(verdict(72), /^A good session/);
  assert.match(verdict(45), /^Some of it/);
  assert.match(verdict(10), /hasn’t settled yet/);
});
