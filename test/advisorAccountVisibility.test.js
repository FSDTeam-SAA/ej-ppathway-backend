import test from 'node:test';
import assert from 'node:assert/strict';
import User from '../models/user.model.js';
import AdvisorProfile from '../models/advisorProfile.model.js';
import Favorite from '../models/favorite.model.js';
import PlatformSetting from '../models/platformSetting.model.js';
import { featured, topRated, searchAdvisors, getAdvisorDetails, recommendedAdvisors } from '../controllers/publicAdvisor.controller.js';
import { addFavorite, listFavorites } from '../controllers/user.controller.js';
import { buildAdvisorAvailability } from '../controllers/session.controller.js';
import { listAdvisors } from '../controllers/admin.advisors.controller.js';

const invoke = (handler, req = {}) => new Promise((resolve, reject) => {
  const res = { status: () => res, json: resolve };
  handler({ query: {}, params: {}, user: { _id: 'seeker' }, ...req }, res, reject);
});

// In-memory query adapter keeps these controller tests independent of a database.
function query(rows) {
  const chain = {
    select: () => chain, populate: () => chain, sort: () => chain,
    skip: (n) => { rows = rows.slice(n); return chain; },
    limit: (n) => { rows = rows.slice(0, n); return chain; },
    lean: async () => rows,
    then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject)
  };
  return chain;
}

function setup(t) {
  const users = ['active', 'deactivated', 'suspended', 'pending_verification'].map((status, index) => ({
    _id: String(index), name: `Advisor ${index}`, role: 'advisor', status
  }));
  const profiles = users.map((user) => ({
    _id: `profile-${user._id}`, user: user._id, expertise: ['faith'], styles: [], languages: [],
    profileReviewStatus: 'approved', isFeaturedOnHome: user.status !== 'active'
  }));
  const matchingUsers = (filter) => users.filter((user) =>
    (!filter.status || user.status === filter.status) &&
    (!filter._id?.$in || filter._id.$in.includes(user._id)) &&
    (typeof filter._id !== 'string' || user._id === filter._id));
  const matchingProfiles = (filter) => profiles.filter((profile) =>
    (!filter._id?.$nin || !filter._id.$nin.includes(profile._id)) &&
    (!filter.user?.$in || filter.user.$in.includes(profile.user)) &&
    (!filter.user?.$ne || filter.user.$ne !== profile.user) &&
    (filter.isFeaturedOnHome === undefined || filter.isFeaturedOnHome === profile.isFeaturedOnHome));
  t.mock.method(User, 'find', (filter) => query(matchingUsers(filter)));
  t.mock.method(User, 'countDocuments', async (filter) => matchingUsers(filter).length);
  t.mock.method(User, 'findOne', (filter) => {
    const found = matchingUsers(filter)[0] || null;
    return { lean: async () => found, select: async () => found, then: (resolve) => Promise.resolve(found).then(resolve) };
  });
  t.mock.method(AdvisorProfile, 'find', (filter) => query(matchingProfiles(filter)));
  t.mock.method(AdvisorProfile, 'countDocuments', async (filter) => matchingProfiles(filter).length);
  t.mock.method(AdvisorProfile, 'findOne', (filter) => ({ lean: async () => profiles.find((p) => p.user === filter.user) }));
  t.mock.method(PlatformSetting, 'findOne', async () => new PlatformSetting({ key: 'global' }));
  t.mock.method(PlatformSetting.prototype, 'save', async function () { return this; });
  t.mock.method(Favorite, 'find', () => query(users.map((user) => ({ advisor: user._id }))));
  return { users, profiles };
}

for (const [name, handler] of [['featured', featured], ['top rated', topRated], ['search', searchAdvisors]]) {
  test(`${name} filters inactive accounts before pagination/counts and restores reactivated advisors`, async (t) => {
    const { users } = setup(t);
    const first = await invoke(handler, { query: { limit: '1' } });
    assert.deepEqual(first.data.map((item) => item.user._id), ['0']);
    assert.equal(first.meta.total, 1);
    // For featured, inactive curated picks must not suppress the active fallback.
    users[1].status = 'active';
    const restored = await invoke(handler, { query: { limit: '10' } });
    assert.ok(restored.data.some((item) => item.user._id === '1'));
    assert.ok(restored.data.every((item) => item.user.status === 'active'));
    users[0].status = 'deactivated';
    const hidden = await invoke(handler);
    assert.ok(hidden.data.every((item) => item.user._id !== '0'));
  });
}

test('recommendations exclude inactive advisors and restore them after reactivation', async (t) => {
  const { users } = setup(t);
  assert.deepEqual((await invoke(recommendedAdvisors, { params: { advisorId: '0' } })).data, []);
  users[1].status = 'active';
  assert.deepEqual((await invoke(recommendedAdvisors, { params: { advisorId: '0' } })).data.map((item) => item.user._id), ['1']);
  await assert.rejects(invoke(recommendedAdvisors, { params: { advisorId: '2' } }), { statusCode: 404 });
});

test('inactive direct profiles, favorite additions, availability and public schedules are unavailable', async (t) => {
  setup(t);
  const favoriteWrite = t.mock.method(Favorite, 'findOneAndUpdate', () => { throw new Error('Must not add inactive favorite'); });
  for (const advisorId of ['1', '2', '3']) {
    await assert.rejects(invoke(getAdvisorDetails, { params: { advisorId } }), { statusCode: 404 });
    await assert.rejects(invoke(addFavorite, { params: { advisorId } }), { statusCode: 404 });
    await assert.rejects(buildAdvisorAvailability({ advisorId }), { statusCode: 404 });
    await assert.rejects(buildAdvisorAvailability({ advisorId, scheduleOnly: true }), { statusCode: 404 });
  }
  assert.equal(favoriteWrite.mock.callCount(), 0);
});

test('favorites hide inactive advisors without deleting favorites and restore them on activation', async (t) => {
  const { users } = setup(t);
  const removed = t.mock.method(Favorite, 'findOneAndDelete', () => { throw new Error('Must retain favorite'); });
  assert.deepEqual((await invoke(listFavorites)).data.map((item) => item.user._id), ['0']);
  users[1].status = 'active';
  assert.deepEqual((await invoke(listFavorites)).data.map((item) => item.user._id), ['0', '1']);
  assert.equal(removed.mock.callCount(), 0);
});

test('admin advisor list and inactive status filter still include deactivated accounts', async (t) => {
  setup(t);
  assert.equal((await invoke(listAdvisors)).data.length, 4);
  const inactive = await invoke(listAdvisors, { query: { status: 'deactivated' } });
  assert.deepEqual(inactive.data.map((item) => item.user._id), ['1']);
});
