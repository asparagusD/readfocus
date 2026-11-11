// node --test (npm run test:unit): initials for the account button.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayName, initials } from './initials.js';

test('a display name gives its first and last initials', () => {
  assert.equal(initials({ email: 'x@y.z', user_metadata: { display_name: 'Fazle Rahman' } }), 'FR');
  assert.equal(initials({ email: 'x@y.z', user_metadata: { full_name: 'Mary Ann Evans' } }), 'ME');
  assert.equal(displayName({ user_metadata: { name: '  Ada  ' } }), 'Ada');
});

test('without a name, the email local part split on separators', () => {
  assert.equal(initials({ email: 'fazle.rahman@example.com' }), 'FR');
  assert.equal(initials({ email: 'reader@e2e.test' }), 'R');
  assert.equal(initials({ email: 'mary_ann-evans@x.org' }), 'ME');
  assert.equal(initials({ email: 'émile+books@x.fr' }), 'ÉB');
});

test('digits and empty input fall back to a question mark', () => {
  assert.equal(initials({ email: '12345@x.org' }), '?');
  assert.equal(initials(null), '?');
  assert.equal(initials({ email: 'r2d2@x.org' }), 'R');
});
