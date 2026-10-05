import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Session from '../models/session.model.js';
import AdvisorProfile from '../models/advisorProfile.model.js';
import { listSessions } from '../controllers/admin.sessions.controller.js';

test('session list preserves missing-advisor rows and only queries valid advisor IDs', async (t) => {
  const advisorId = new mongoose.Types.ObjectId();
  const items = [
    { _id: 'missing', advisor: null },
    { _id: 'absent' },
    { _id: 'invalid', advisor: 'null' },
    { _id: 'valid', advisor: { _id: advisorId, name: 'Advisor' } },
    { _id: 'duplicate', advisor: advisorId }
  ];
  const overview = [{ _id: 'completed', count: items.length }];
  t.mock.method(Session, 'countDocuments', async () => items.length);
  const chain = {};
  for (const method of ['populate', 'sort', 'skip', 'limit']) chain[method] = () => chain;
  chain.lean = async () => items;
  t.mock.method(Session, 'find', () => chain);
  t.mock.method(Session, 'aggregate', async () => overview);
  const originalFind = AdvisorProfile.find.bind(AdvisorProfile);
  t.mock.method(AdvisorProfile, 'find', (filter) => {
    assert.deepEqual(filter.user.$in, [String(advisorId)]);
    // Use Mongoose's actual cast to catch the original Invalid user: null error.
    originalFind(filter).cast(AdvisorProfile);
    return { select: () => ({ lean: async () => [{ user: advisorId, tier: 'gold' }] }) };
  });
  const response = await new Promise((resolve, reject) => {
    const res = { status: (code) => { assert.equal(code, 200); return res; }, json: resolve };
    listSessions({ query: { tab: 'completed', page: '1', limit: '10' } }, res, reject);
  });
  assert.equal(response.success, true);
  assert.equal(response.data.length, items.length);
  assert.equal(response.data[0].advisor, null);
  assert.deepEqual(response.data.map((s) => s.advisorTier), ['', '', '', 'gold', 'gold']);
  assert.equal(response.meta.total, items.length);
  assert.deepEqual(response.meta.overview, overview);

  // A page containing only missing advisors must still return successfully.
  items.splice(3);
  const secondResponse = await new Promise((resolve, reject) => {
    const res = { status: () => res, json: resolve };
    listSessions({ query: { tab: 'completed' } }, res, reject);
  });
  assert.equal(secondResponse.data.length, 3);
  assert.equal(AdvisorProfile.find.mock.callCount(), 1);
});
