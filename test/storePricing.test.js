import assert from 'node:assert/strict';
import test from 'node:test';

import { createAppleInlineId } from '../services/storePricing.service.js';

test('Apple inline resource IDs use the required local ID format', () => {
  const id = createAppleInlineId();
  assert.match(id, /^\$\{price-\d+-[a-f0-9]{8}\}$/);
});
