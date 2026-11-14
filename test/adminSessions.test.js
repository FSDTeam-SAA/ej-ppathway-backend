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

for (const [period, end] of [
  [undefined, undefined],
  ['today', '2026-11-15T00:00:00.000Z'],
  ['week', '2026-11-15T00:00:00.000Z'],
  ['month', '2026-12-01T00:00:00.000Z']
]) {
  test(`upcoming sessions use scheduled time, active booking statuses and chronological pagination (${period || 'all dates'})`, async (t) => {
    const now = new Date('2026-11-14T10:30:00.000Z');
    t.mock.timers.enable({ apis: ['Date'], now });
    let countedFilter;
    let listedFilter;
    let sort;
    let skip;
    let limit;
    t.mock.method(Session, 'countDocuments', async (filter) => {
      countedFilter = filter;
      return 12;
    });
    const booking = {
      _id: 'booking', sessionCode: 'SES-123456',
      user: { name: 'Seeker' }, advisor: null,
      scheduledFor: '2026-11-14T11:00:00.000Z',
      durationMinutes: 15, actualDurationSec: 0, type: 'call', status: 'waiting'
    };
    const chain = {
      populate: () => chain,
      sort: (value) => { sort = value; return chain; },
      skip: (value) => { skip = value; return chain; },
      limit: (value) => { limit = value; return chain; },
      lean: async () => [booking]
    };
    t.mock.method(Session, 'find', (filter) => { listedFilter = filter; return chain; });
    t.mock.method(Session, 'aggregate', async () => []);
    const response = await new Promise((resolve, reject) => {
      const res = { status: () => res, json: resolve };
      listSessions({ query: { tab: 'upcoming', period, type: 'call', page: '2', limit: '10' } }, res, reject);
    });
    assert.deepEqual(listedFilter, {
      status: { $in: ['pending', 'consent', 'waiting'] },
      scheduledFor: { $gte: now, ...(end ? { $lt: new Date(end) } : {}) },
      type: 'call'
    });
    assert.deepEqual(countedFilter, listedFilter);
    assert.deepEqual(sort, { scheduledFor: 1, _id: 1 });
    assert.equal(skip, 10);
    assert.equal(limit, 10);
    assert.equal(response.meta.total, 12);
    assert.equal(response.data[0].sessionCode, booking.sessionCode);
    assert.equal(response.data[0].durationMinutes, 15);
    assert.equal(response.data[0].status, 'waiting');
  });
}
