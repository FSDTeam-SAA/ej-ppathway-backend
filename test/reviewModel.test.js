import assert from 'node:assert/strict';
import test from 'node:test';

import Review from '../models/review.model.js';

test('enforces one review per session while allowing sessionless showcase reviews', () => {
  const sessionIndex = Review.schema.indexes().find(
    ([fields]) => fields.session === 1 && Object.keys(fields).length === 1
  );

  assert.ok(sessionIndex);
  assert.equal(sessionIndex[1].unique, true);
  assert.equal(sessionIndex[1].sparse, true);
});
